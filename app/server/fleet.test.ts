// Fleet logic against a fake terminal on this computer's LAN address
// (the backend only talks to private IPv4 addresses).

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.NFC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nfc-tm-fleet-"));

// Fake terminal: GET /, GET /diag, POST /connect with the firmware's auth rules.
const fake = {
  serial: "ESP32_RFID_AABBCCDDEEFF",
  barrier: "b1",
  configured: true,
  authFailures: 0,
  lastConnect: null as Record<string, string> | null,
};

const server = http.createServer((req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const auth = req.headers.authorization;
  if (req.method === "GET" && req.url === "/") {
    return send(200, { serial_number: fake.serial, model: "ESP32_RFID_001", software_version: "1.1.0", nfc_status: "ready", connection_status: fake.configured ? "connected" : "not connected" });
  }
  if (req.method === "GET" && req.url === "/diag") {
    if (!fake.configured) return send(403, { status: "error", message: "device is not configured" });
    if (auth !== fake.barrier) {
      fake.authFailures++;
      return send(401, { status: "error", message: "invalid Authorization" });
    }
    return send(200, { software_version: "1.1.0", uptime_s: 5, heap_free: 1, heap_min_free: 1, latch_k: 3, link_up: true, net_up: true, server_reachable: true, stack_free_bytes: {}, stats: {} });
  }
  if (req.method === "POST" && req.url === "/connect") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, string>;
      if (auth !== fake.barrier) {
        fake.authFailures++;
        return send(401, { status: "error", message: "invalid Authorization" });
      }
      fake.lastConnect = body;
      fake.barrier = body.barrier;
      send(200, { status: "success", restart: false });
    });
    return;
  }
  send(404, {});
});

const lan = Object.values(os.networkInterfaces())
  .flat()
  .find((a) => a && a.family === "IPv4" && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))?.address;

let Fleet: typeof import("./fleet.ts").Fleet;

before(async () => {
  await new Promise<void>((r) => server.listen(0, "0.0.0.0", () => r()));
  process.env.NFC_TERMINAL_PORT = String((server.address() as AddressInfo).port);
  ({ Fleet } = await import("./fleet.ts"));
});

after(() => {
  server.close();
  fs.rmSync(process.env.NFC_DATA_DIR!, { recursive: true, force: true });
});

test("fleet: add, barrier check, connect keeps or changes the barrier, persistence", { skip: !lan && "no private LAN address" }, async () => {
  const fleet = new Fleet();
  const t = await fleet.add(lan!);
  assert.equal(t.serial, fake.serial);
  assert.equal(t.hasBarrier, false);
  assert.ok(!("barrier" in t), "barrier is never returned");

  // A wrong barrier is rejected and not stored.
  await assert.rejects(fleet.setBarrier(fake.serial, "wrong"), /wrong_barrier/);
  assert.equal(fleet.get(fake.serial).hasBarrier, false);

  // The right one is verified and stored.
  const ok = await fleet.setBarrier(fake.serial, "b1");
  assert.equal(ok.hasBarrier, true);
  assert.equal(ok.barrierOk, true);
  assert.equal((await fleet.diag(fake.serial)).server_reachable, true);

  // connect without a new barrier sends the saved one as both auth and value.
  const r1 = await fleet.connect(fake.serial, { url: "https://a/x", api_key: "k" }, {});
  assert.equal(r1.status, 200);
  assert.equal(fake.lastConnect?.barrier, "b1");

  // connect with a new barrier stores it.
  await fleet.connect(fake.serial, { url: "https://a/x", api_key: "k", barrier: "b2" }, {});
  assert.equal(fake.barrier, "b2");
  assert.equal((await fleet.diag(fake.serial)).link_up, true);

  // Saved data survives a restart, keyed by serial.
  fleet.rename(fake.serial, "Main entrance");
  fleet.stop();
  const again = new Fleet();
  assert.equal(again.get(fake.serial).name, "Main entrance");
  assert.equal(again.get(fake.serial).hasBarrier, true);
  const stored = fs.readFileSync(path.join(process.env.NFC_DATA_DIR!, "terminals.json"));
  assert.equal(fs.statSync(path.join(process.env.NFC_DATA_DIR!, "terminals.json")).mode & 0o077, 0, "file is private (0600)");
  assert.ok(stored.includes("b2"));
});

test("fleet: a rejected barrier is not used again (no lock-out by polling)", { skip: !lan && "no private LAN address" }, async () => {
  const fleet = new Fleet();
  fake.barrier = "changed-elsewhere";
  fake.authFailures = 0;
  await assert.rejects(fleet.diag(fake.serial), /wrong_barrier/);
  assert.equal(fleet.get(fake.serial).barrierOk, false);
  // Further calls fail locally without reaching the terminal.
  await assert.rejects(fleet.diag(fake.serial), /barrier_rejected/);
  await assert.rejects(fleet.connect(fake.serial, { url: "https://a/x", api_key: "k" }, {}), /barrier_rejected/);
  assert.equal(fake.authFailures, 1);
  fleet.stop();
});

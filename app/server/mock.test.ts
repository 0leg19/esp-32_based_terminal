// node --test server/*.test.ts
//
// Exercises the test server the way a terminal does: HTTPS with the
// provisioned CA as the only trust anchor and the IP address as host name.

import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.NFC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "nfc-tm-test-"));
process.env.MOCK_HTTPS_PORT = "0";
process.env.MOCK_HTTP_PORT = "0";

const { MockServer, normalizeUid, sanitizeConfig } = await import("./mock.ts");
const { lanInterfaces } = await import("./store.ts");

const mock = new MockServer();
let port = 0;

before(async () => {
  await mock.start();
  port = mock.port("https") ?? 0;
  mock.setConfig({ apiKey: "k", barrier: "b", checkAuth: true, defaultAction: "deny", rules: [], simulate: "none", delayMs: 0 });
});

after(async () => {
  await mock.stop();
  fs.rmSync(process.env.NFC_DATA_DIR!, { recursive: true, force: true });
});

function checkCard(
  host: string,
  uid: string,
  headers: Record<string, string> = { "x-api-key": "k", Authorization: "b" },
): Promise<{ status: number; body: { message?: string } }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        port,
        path: "/check_card",
        method: "POST",
        ca: mock.caCert,
        headers: { "Content-Type": "application/json", ...headers },
        timeout: 3000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : {} }));
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end(JSON.stringify({ action: "check_card", uid }));
  });
}

test("certificate verifies against the CA for every LAN address", async () => {
  const hosts = ["127.0.0.1", ...lanInterfaces().map((i) => i.address)];
  for (const h of hosts) {
    const r = await checkCard(h, "04A1B2C3");
    assert.equal(r.status, 403, `host ${h}`);
  }
});

test("wrong api_key or barrier is rejected with 401", async () => {
  assert.equal((await checkCard("127.0.0.1", "04A1", { "x-api-key": "x", Authorization: "b" })).status, 401);
  assert.equal((await checkCard("127.0.0.1", "04A1", { "x-api-key": "k", Authorization: "x" })).status, 401);
  assert.equal((await checkCard("127.0.0.1", "04A1", {})).status, 401);
});

test("rules decide per UID; unknown cards get the default", async () => {
  mock.setConfig({
    rules: [
      { uid: "04:a1:b2:c3", name: "Nino", action: "allow", message: "Welcome Nino" },
      { uid: "DEAD", name: "", action: "deny" },
      { uid: "BEEF", name: "", action: "error", status: 503 },
    ],
  });
  const ok = await checkCard("127.0.0.1", "04a1b2c3");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.message, "Welcome Nino");
  assert.equal((await checkCard("127.0.0.1", "DEAD")).status, 403);
  assert.equal((await checkCard("127.0.0.1", "BEEF")).status, 503);
  assert.equal((await checkCard("127.0.0.1", "0000")).status, 403);
  mock.setConfig({ defaultAction: "allow" });
  assert.equal((await checkCard("127.0.0.1", "0000")).status, 200);
});

test("events record UID, result and key checks", async () => {
  mock.clearEvents();
  await checkCard("127.0.0.1", "04A1B2C3");
  const e = mock.events.at(-1)!;
  assert.equal(e.uid, "04A1B2C3");
  assert.equal(e.status, 200);
  assert.equal(e.rule, "Nino");
  assert.equal(e.apiKeyOk, true);
  assert.equal(e.barrierOk, true);
  assert.equal(e.protocol, "https");
});

test("simulated faults", async () => {
  mock.setConfig({ simulate: "error500" });
  assert.equal((await checkCard("127.0.0.1", "04A1B2C3")).status, 500);
  mock.setConfig({ simulate: "close" });
  await assert.rejects(checkCard("127.0.0.1", "04A1B2C3"));
  mock.setConfig({ simulate: "none" });
});

test("config is sanitised", () => {
  const base = mock.config;
  const c = sanitizeConfig(
    {
      apiKey: "x".repeat(100),
      delayMs: 999999,
      simulate: "bogus" as never,
      rules: [{ uid: "zz", name: "n", action: "nope" as never }, { uid: "04-A1", name: "", action: "allow" }],
    },
    base,
  );
  assert.equal(c.apiKey.length, 64);
  assert.equal(c.delayMs, 30000);
  assert.equal(c.simulate, "none");
  assert.deepEqual(
    c.rules.map((r) => r.uid),
    ["04A1"],
  );
  assert.equal(normalizeUid("04:a1 b2"), "04A1B2");
});

// Local data directory (app/data): CA, server certificate, OTA keys and the
// test-server settings. It is git-ignored; private keys never leave it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.NFC_DATA_DIR ?? path.join(APP_ROOT, "data");

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export function dataPath(name: string): string {
  return path.join(DATA_DIR, name);
}

export function readText(name: string): string | null {
  try {
    return fs.readFileSync(dataPath(name), "utf8");
  } catch {
    return null;
  }
}

export function writeText(name: string, text: string, secret = false): void {
  fs.writeFileSync(dataPath(name), text, { mode: secret ? 0o600 : 0o644 });
}

export function readJson<T>(name: string, fallback: T): T {
  const text = readText(name);
  if (text === null) return fallback;
  try {
    return { ...fallback, ...JSON.parse(text) };
  } catch {
    return fallback;
  }
}

export function writeJson(name: string, value: unknown): void {
  writeText(name, JSON.stringify(value, null, 2));
}

// ---- network helpers ----

export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export interface LanInterface {
  name: string;
  address: string;
  netmask: string;
}

/** Private IPv4 addresses of this computer (where the terminal can reach us). */
export function lanInterfaces(): LanInterface[] {
  const out: LanInterface[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && isPrivateIPv4(a.address)) {
        out.push({ name, address: a.address, netmask: a.netmask });
      }
    }
  }
  return out;
}

function ipToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

/** The local address on the same subnet as `peer`, else the first one. */
export function localAddressFor(peer: string | undefined): string | null {
  const list = lanInterfaces();
  if (peer && isPrivateIPv4(peer)) {
    const p = ipToInt(peer);
    const hit = list.find((i) => ((ipToInt(i.address) ^ p) & ipToInt(i.netmask)) === 0);
    if (hit) return hit.address;
  }
  return list[0]?.address ?? null;
}

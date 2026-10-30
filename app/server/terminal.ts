// Access to the terminal's local API (port 80). The browser cannot call it
// directly (no CORS on the device), so the UI goes through these helpers.
// Only private IPv4 addresses are allowed, so this is never an open proxy.

import { isPrivateIPv4, lanInterfaces } from "./store.ts";

export interface TerminalInfo {
  creator?: string;
  serial_number: string;
  software_version?: string;
  model: string;
  unique_number?: string;
  ip_address?: string;
  connection?: string;
  nfc_status?: string;
  connection_status?: string;
  provisioning?: string;
}

export interface TerminalResponse {
  status: number;
  body: unknown;
}

export class TerminalError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Always 80 on real terminals; overridable for tests.
const PORT = Number(process.env.NFC_TERMINAL_PORT ?? 80);

function assertIp(ip: string): void {
  if (!isPrivateIPv4(ip)) throw new TerminalError("bad_ip", "only private IPv4 addresses are allowed");
}

export async function terminalRequest(
  ip: string,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: BodyInit; timeoutMs?: number } = {},
): Promise<TerminalResponse> {
  assertIp(ip);
  let res: Response;
  try {
    res = await fetch(`http://${ip}${PORT === 80 ? "" : `:${PORT}`}${path}`, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs ?? 5000),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new TerminalError(timeout ? "timeout" : "unreachable", timeout ? "no answer from the terminal" : String(err));
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: res.status, body };
}

export function isTerminalInfo(body: unknown): body is TerminalInfo {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as TerminalInfo).model === "string" &&
    typeof (body as TerminalInfo).serial_number === "string"
  );
}

export async function terminalInfo(ip: string, timeoutMs = 3000): Promise<TerminalInfo> {
  const r = await terminalRequest(ip, "/", { timeoutMs });
  if (r.status !== 200 || !isTerminalInfo(r.body)) throw new TerminalError("not_terminal", "not an NFC terminal");
  return r.body;
}

/** Probe every address of the /24 networks this computer is on. */
export async function discover(subnet?: string): Promise<{ ip: string; info: TerminalInfo }[]> {
  const prefixes = new Set<string>();
  if (subnet && /^\d+\.\d+\.\d+$/.test(subnet) && isPrivateIPv4(`${subnet}.1`)) prefixes.add(subnet);
  else for (const i of lanInterfaces()) prefixes.add(i.address.split(".").slice(0, 3).join("."));

  const own = new Set(lanInterfaces().map((i) => i.address));
  const targets: string[] = [];
  for (const p of prefixes) for (let h = 1; h < 255; h++) if (!own.has(`${p}.${h}`)) targets.push(`${p}.${h}`);

  const found: { ip: string; info: TerminalInfo }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < targets.length) {
      const ip = targets[next++];
      try {
        found.push({ ip, info: await terminalInfo(ip, 900) });
      } catch {
        /* nothing there */
      }
    }
  };
  await Promise.all(Array.from({ length: 64 }, worker));
  return found.sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}

// Test check_card server. The terminal sends
//   POST <url>  x-api-key: <api_key>  Authorization: <barrier>
//   {"action":"check_card","uid":"04A1B2C3"}
// and shows green for 200, red for 401/403 and an error for anything else.
// Responses are driven by per-UID rules; every request is recorded and
// pushed to the UI.

import { EventEmitter } from "node:events";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";

import { serverCredentials } from "./pki.ts";
import { localAddressFor, readJson, writeJson } from "./store.ts";

export type Action = "allow" | "deny" | "error";
export type Simulation = "none" | "error500" | "timeout" | "close";

export interface Rule {
  uid: string;
  name: string;
  action: Action;
  status?: number;
  message?: string;
}

export interface MockConfig {
  apiKey: string;
  barrier: string;
  checkAuth: boolean;
  defaultAction: "allow" | "deny";
  delayMs: number;
  simulate: Simulation;
  allowMessage: string;
  denyMessage: string;
  rules: Rule[];
}

export interface MockEvent {
  id: number;
  time: string;
  remote: string;
  protocol: "https" | "http";
  path: string;
  uid: string | null;
  apiKeyOk: boolean | null;
  barrierOk: boolean | null;
  status: number | null;
  message: string;
  rule: string | null;
  durationMs: number;
  error?: string;
}

const CONFIG_FILE = "mock.json";
export const HTTPS_PORT = Number(process.env.MOCK_HTTPS_PORT ?? 8443);
export const HTTP_PORT = Number(process.env.MOCK_HTTP_PORT ?? 8090);
const MAX_EVENTS = 500;

const DEFAULT_CONFIG: MockConfig = {
  apiKey: "test-api-key",
  barrier: "test-barrier",
  checkAuth: true,
  defaultAction: "deny",
  delayMs: 0,
  simulate: "none",
  allowMessage: "Access Granted",
  denyMessage: "Access Denied",
  rules: [],
};

export function normalizeUid(uid: string): string {
  return uid.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

export function sanitizeConfig(input: Partial<MockConfig>, base: MockConfig): MockConfig {
  const c: MockConfig = { ...base, ...input };
  c.apiKey = String(c.apiKey).slice(0, 64);
  c.barrier = String(c.barrier).slice(0, 64);
  c.checkAuth = Boolean(c.checkAuth);
  c.defaultAction = c.defaultAction === "allow" ? "allow" : "deny";
  c.delayMs = Math.max(0, Math.min(30000, Math.round(Number(c.delayMs) || 0)));
  c.simulate = (["none", "error500", "timeout", "close"] as const).includes(c.simulate) ? c.simulate : "none";
  c.allowMessage = String(c.allowMessage ?? "").slice(0, 76);
  c.denyMessage = String(c.denyMessage ?? "").slice(0, 76);
  c.rules = (Array.isArray(c.rules) ? c.rules : [])
    .map((r) => ({
      uid: normalizeUid(String(r.uid ?? "")),
      name: String(r.name ?? "").slice(0, 64),
      action: (["allow", "deny", "error"] as const).includes(r.action) ? r.action : "deny",
      status: r.status === undefined || r.status === null ? undefined : Math.max(100, Math.min(599, Number(r.status) || 500)),
      message: r.message === undefined ? undefined : String(r.message).slice(0, 76),
    }))
    .filter((r) => r.uid.length >= 2 && r.uid.length <= 20);
  return c;
}

export class MockServer extends EventEmitter {
  config: MockConfig;
  events: MockEvent[] = [];
  private nextId = 1;
  private httpsServer: https.Server | null = null;
  private httpServer: http.Server | null = null;
  names: string[] = [];
  caCert = "";
  listenErrors: string[] = [];

  constructor() {
    super();
    this.config = sanitizeConfig(readJson<MockConfig>(CONFIG_FILE, DEFAULT_CONFIG), DEFAULT_CONFIG);
  }

  setConfig(input: Partial<MockConfig>): MockConfig {
    this.config = sanitizeConfig(input, this.config);
    writeJson(CONFIG_FILE, this.config);
    return this.config;
  }

  clearEvents(): void {
    this.events = [];
    this.emit("cleared");
  }

  async start(): Promise<void> {
    const creds = serverCredentials();
    this.names = creds.names;
    this.caCert = creds.caCert;
    this.listenErrors = [];
    const handler = (proto: "https" | "http") => (req: http.IncomingMessage, res: http.ServerResponse) =>
      void this.handle(proto, req, res);
    this.httpsServer = https.createServer({ key: creds.key, cert: creds.cert }, handler("https"));
    this.httpServer = http.createServer(handler("http"));
    await Promise.all([
      this.listen(this.httpsServer, HTTPS_PORT, "https"),
      this.listen(this.httpServer, HTTP_PORT, "http"),
    ]);
  }

  /** Re-issue the certificate if the LAN addresses changed. */
  async refresh(): Promise<void> {
    const creds = serverCredentials();
    if (creds.names.join(",") === this.names.join(",")) return;
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    await Promise.all(
      [this.httpsServer, this.httpServer].map(
        (s) => new Promise<void>((resolve) => (s && s.listening ? s.close(() => resolve()) : resolve())),
      ),
    );
  }

  private listen(server: http.Server | https.Server, port: number, label: string): Promise<void> {
    return new Promise((resolve) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        this.listenErrors.push(`${label} :${port} ${err.code ?? err.message}`);
        resolve();
      });
      server.listen(port, "0.0.0.0", () => resolve());
    });
  }

  port(proto: "https" | "http"): number | null {
    const s = proto === "https" ? this.httpsServer : this.httpServer;
    const addr = s?.listening ? (s.address() as AddressInfo) : null;
    return addr?.port ?? null;
  }

  /** URLs the terminal should use (address on the terminal's subnet). */
  urls(terminalIp?: string): { https: string | null; http: string | null; host: string | null } {
    const host = localAddressFor(terminalIp);
    const hp = this.port("https");
    const pp = this.port("http");
    return {
      host,
      https: host && hp ? `https://${host}:${hp}/check_card` : null,
      http: host && pp ? `http://${host}:${pp}/check_card` : null,
    };
  }

  private record(e: Omit<MockEvent, "id" | "time">): void {
    const ev: MockEvent = { id: this.nextId++, time: new Date().toISOString(), ...e };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.emit("event", ev);
  }

  private async handle(protocol: "https" | "http", req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const started = Date.now();
    const remote = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
    const path = (req.url ?? "/").slice(0, 200);
    const c = this.config;

    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "nfc-terminal-manager test server" }));
      return;
    }

    let raw = "";
    try {
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) throw new Error("body too large");
      }
    } catch (err) {
      res.writeHead(413).end();
      this.record({ remote, protocol, path, uid: null, apiKeyOk: null, barrierOk: null, status: 413, message: "", rule: null, durationMs: Date.now() - started, error: String(err) });
      return;
    }

    let uid: string | null = null;
    let parseError: string | undefined;
    try {
      const body = JSON.parse(raw) as { action?: string; uid?: string };
      if (body.action !== "check_card") parseError = `unexpected action: ${String(body.action)}`;
      uid = typeof body.uid === "string" ? normalizeUid(body.uid) : null;
      if (!uid) parseError = "missing uid";
    } catch {
      parseError = "invalid JSON";
    }

    const apiKey = String(req.headers["x-api-key"] ?? "");
    const barrier = String(req.headers["authorization"] ?? "");
    const apiKeyOk = apiKey === c.apiKey;
    const barrierOk = barrier === c.barrier;

    if (c.delayMs > 0) await new Promise((r) => setTimeout(r, c.delayMs));

    const base = { remote, protocol, path, uid, apiKeyOk, barrierOk };
    const done = (status: number | null, message: string, rule: string | null, error?: string) =>
      this.record({ ...base, status, message, rule, durationMs: Date.now() - started, error });

    if (c.simulate === "close") {
      req.socket.destroy();
      done(null, "", null, "connection closed (simulated)");
      return;
    }
    if (c.simulate === "timeout") {
      // The terminal gives up after 5 s; keep the socket open longer.
      setTimeout(() => req.socket.destroy(), 8000);
      done(null, "", null, "no response (simulated timeout)");
      return;
    }

    const reply = (status: number, message: string, rule: string | null, error?: string) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ message }));
      done(status, message, rule, error);
    };

    if (c.simulate === "error500") return reply(500, "Internal Server Error", null, "simulated");
    if (parseError) return reply(400, "Bad Request", null, parseError);
    if (c.checkAuth && (!apiKeyOk || !barrierOk)) {
      return reply(401, "Unauthorized terminal", null, !apiKeyOk ? "x-api-key mismatch" : "Authorization mismatch");
    }

    const rule = c.rules.find((r) => r.uid === uid);
    if (rule) {
      if (rule.action === "allow") return reply(rule.status ?? 200, rule.message || c.allowMessage, rule.name || rule.uid);
      if (rule.action === "deny") return reply(rule.status ?? 403, rule.message || c.denyMessage, rule.name || rule.uid);
      return reply(rule.status ?? 500, rule.message || "Server Error", rule.name || rule.uid);
    }
    if (c.defaultAction === "allow") return reply(200, c.allowMessage, null);
    return reply(403, c.denyMessage, null);
  }
}

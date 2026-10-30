// The managed terminals. Identified by serial number (derived from the
// chip's MAC), so a terminal that gets a new IP address from DHCP is
// recognised again by a network scan. Every terminal is polled in the
// background: GET / always, GET /diag when a verified barrier is saved.
//
// Barriers are stored in app/data/terminals.json (mode 0600) and never
// returned to the browser. A barrier that the terminal rejects is marked
// and not used again until it is replaced, so polling can never trigger
// the terminal's lock-out.

import { EventEmitter } from "node:events";

import { readJson, writeText } from "./store.ts";
import { TerminalError, discover, terminalInfo, terminalRequest } from "./terminal.ts";
import type { TerminalInfo } from "./terminal.ts";

const FILE = "terminals.json";
const POLL_MS = 5000;
const SAVE_MS = 15000;
const CONCURRENCY = 16;

export interface Diag {
  software_version: string;
  uptime_s: number;
  heap_free: number;
  heap_min_free: number;
  latch_k: number;
  link_up?: boolean;
  net_up?: boolean;
  server_reachable?: boolean;
  stack_free_bytes: Record<string, number>;
  stats: Record<string, number>;
}

interface Stored {
  serial: string;
  ip: string;
  name: string;
  barrier?: string;
  barrierOk: boolean | null;
  addedAt: string;
  lastSeen: string | null;
  info: TerminalInfo | null;
}

interface Entry extends Stored {
  online: boolean | null;
  diag: Diag | null;
  diagAt: string | null;
  error: string | null;
}

/** What the browser gets: everything except the barrier itself. */
export type FleetView = Omit<Entry, "barrier"> & { hasBarrier: boolean };

export class FleetError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message = code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class Fleet extends EventEmitter {
  private entries = new Map<string, Entry>();
  private polling = false;
  private dirty = false;
  private timers: NodeJS.Timeout[] = [];

  constructor() {
    super();
    const data = readJson<{ terminals: Stored[] }>(FILE, { terminals: [] });
    for (const s of data.terminals) {
      if (s && typeof s.serial === "string" && typeof s.ip === "string") {
        this.entries.set(s.serial, { ...s, online: null, diag: null, diagAt: null, error: null });
      }
    }
  }

  start(): void {
    void this.pollAll();
    this.timers.push(setInterval(() => void this.pollAll(), POLL_MS));
    this.timers.push(setInterval(() => this.flush(), SAVE_MS));
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.flush();
  }

  list(): FleetView[] {
    return [...this.entries.values()].map(view).sort((a, b) => (a.name || a.ip).localeCompare(b.name || b.ip, undefined, { numeric: true }));
  }

  get(serial: string): FleetView {
    return view(this.entry(serial));
  }

  async add(ip: string): Promise<FleetView> {
    const info = await terminalInfo(ip);
    return view(this.upsert(ip, info));
  }

  async scan(): Promise<{ found: number; added: number }> {
    const found = await discover();
    let added = 0;
    for (const f of found) {
      if (!this.entries.has(f.info.serial_number)) added++;
      this.upsert(f.ip, f.info);
    }
    return { found: found.length, added };
  }

  remove(serial: string): void {
    this.entry(serial);
    this.entries.delete(serial);
    this.save();
  }

  rename(serial: string, name: string): FleetView {
    const e = this.entry(serial);
    e.name = name.trim().slice(0, 64);
    this.save();
    return view(e);
  }

  /** Verify the barrier against the terminal before storing it. */
  async setBarrier(serial: string, barrier: string | null): Promise<FleetView> {
    const e = this.entry(serial);
    if (!barrier) {
      delete e.barrier;
      e.barrierOk = null;
      e.diag = null;
      this.save();
      return view(e);
    }
    const r = await terminalRequest(e.ip, "/diag", { headers: { Authorization: barrier } });
    if (r.status === 401) throw new FleetError(401, "wrong_barrier");
    if (r.status === 429) throw new FleetError(429, "locked");
    if (r.status === 403) throw new FleetError(409, "not_configured");
    if (r.status !== 200) throw new FleetError(502, "unexpected", `HTTP ${r.status}`);
    e.barrier = barrier;
    e.barrierOk = true;
    e.diag = r.body as Diag;
    e.diagAt = new Date().toISOString();
    this.save();
    return view(e);
  }

  async diag(serial: string): Promise<Diag> {
    const e = this.entry(serial);
    const barrier = this.usableBarrier(e);
    const r = await terminalRequest(e.ip, "/diag", { headers: { Authorization: barrier } });
    this.afterAuth(e, r.status);
    if (r.status !== 200) throw new FleetError(r.status === 401 ? 401 : 502, r.status === 401 ? "wrong_barrier" : "unexpected");
    e.diag = r.body as Diag;
    e.diagAt = new Date().toISOString();
    return e.diag;
  }

  /**
   * POST /connect. Authorisation: the setup code if given, else the barrier
   * typed by the user, else the saved one. The new barrier is saved on success.
   */
  async connect(serial: string, settings: Record<string, string>, auth: { otp?: string; barrier?: string }): Promise<{ status: number; body: unknown }> {
    const e = this.entry(serial);
    const body = { ...settings };
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth.otp) body.otp = auth.otp;
    else headers.Authorization = auth.barrier || this.usableBarrier(e);
    // No new barrier given: keep the current one (the terminal requires the field).
    if (!body.barrier && !auth.otp) body.barrier = headers.Authorization;
    const r = await terminalRequest(e.ip, "/connect", { method: "POST", headers, body: JSON.stringify(body), timeoutMs: 10000 });
    if (!auth.otp && !auth.barrier) this.afterAuth(e, r.status);
    if (r.status === 200 && body.barrier) {
      e.barrier = body.barrier;
      e.barrierOk = true;
      this.save();
    }
    return r;
  }

  async ota(serial: string, image: Buffer, signature: string): Promise<{ status: number; body: unknown }> {
    const e = this.entry(serial);
    const form = new FormData();
    form.append("firmware", new Blob([new Uint8Array(image)], { type: "application/octet-stream" }), "firmware.bin");
    const r = await terminalRequest(e.ip, "/ota", {
      method: "POST",
      headers: { Authorization: this.usableBarrier(e), "X-Signature": signature },
      body: form,
      timeoutMs: 180000,
    });
    this.afterAuth(e, r.status);
    return r;
  }

  terminalIp(serial: string): string {
    return this.entry(serial).ip;
  }

  // ---- internals ----

  private entry(serial: string): Entry {
    const e = this.entries.get(serial);
    if (!e) throw new FleetError(404, "unknown_terminal");
    return e;
  }

  private usableBarrier(e: Entry): string {
    if (!e.barrier) throw new FleetError(409, "no_barrier");
    if (e.barrierOk === false) throw new FleetError(409, "barrier_rejected");
    return e.barrier;
  }

  private afterAuth(e: Entry, status: number): void {
    if (status === 401 && e.barrierOk !== false) {
      e.barrierOk = false;
      this.save();
    }
  }

  private upsert(ip: string, info: TerminalInfo): Entry {
    const serial = info.serial_number;
    const now = new Date().toISOString();
    // Another terminal that used to have this address has moved.
    for (const other of this.entries.values()) {
      if (other.serial !== serial && other.ip === ip) other.online = false;
    }
    const e = this.entries.get(serial) ?? {
      serial,
      ip,
      name: "",
      barrierOk: null,
      addedAt: now,
      lastSeen: null,
      info: null,
      online: null,
      diag: null,
      diagAt: null,
      error: null,
    };
    e.ip = ip;
    e.info = info;
    e.online = true;
    e.lastSeen = now;
    e.error = null;
    this.entries.set(serial, e);
    this.save();
    return e;
  }

  private async pollOne(e: Entry): Promise<void> {
    try {
      const info = await terminalInfo(e.ip, 2500);
      if (info.serial_number !== e.serial) {
        e.online = false;
        e.error = "other_terminal";
        return;
      }
      e.info = info;
      e.online = true;
      e.lastSeen = new Date().toISOString();
      e.error = null;
      this.dirty = true;
    } catch (err) {
      e.online = false;
      e.error = err instanceof TerminalError ? err.code : "unreachable";
      return;
    }
    if (e.barrier && e.barrierOk !== false && e.info?.connection_status === "connected") {
      try {
        const r = await terminalRequest(e.ip, "/diag", { headers: { Authorization: e.barrier }, timeoutMs: 3000 });
        this.afterAuth(e, r.status);
        if (r.status === 200) {
          e.diag = r.body as Diag;
          e.diagAt = new Date().toISOString();
          if (e.barrierOk !== true) {
            e.barrierOk = true;
            this.dirty = true;
          }
        }
      } catch {
        /* keep the last diagnostics */
      }
    }
  }

  private async pollAll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const queue = [...this.entries.values()];
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
          for (let e = queue.shift(); e; e = queue.shift()) await this.pollOne(e);
        }),
      );
      this.emit("polled");
    } finally {
      this.polling = false;
    }
  }

  private save(): void {
    this.dirty = true;
    this.flush();
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const terminals: Stored[] = [...this.entries.values()].map((e) => ({
      serial: e.serial,
      ip: e.ip,
      name: e.name,
      barrier: e.barrier,
      barrierOk: e.barrierOk,
      addedAt: e.addedAt,
      lastSeen: e.lastSeen,
      info: e.info,
    }));
    writeText(FILE, JSON.stringify({ terminals }, null, 2), true);
  }
}

function view(e: Entry): FleetView {
  const { barrier, ...rest } = e;
  return { ...rest, hasBarrier: Boolean(barrier) };
}

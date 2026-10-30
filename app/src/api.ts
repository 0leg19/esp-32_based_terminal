// Client for the local backend (server/index.ts).

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

export interface FleetTerminal {
  serial: string;
  ip: string;
  name: string;
  hasBarrier: boolean;
  barrierOk: boolean | null;
  addedAt: string;
  lastSeen: string | null;
  info: TerminalInfo | null;
  online: boolean | null;
  diag: Diag | null;
  diagAt: string | null;
  error: string | null;
}

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

export interface MockState {
  config: MockConfig;
  urls: { https: string | null; http: string | null; host: string | null };
  ports: { https: number; http: number };
  listening: { https: boolean; http: boolean };
  errors: string[];
  caCert: string;
  names: string[];
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

export interface OtaKey {
  pem: string | null;
  c?: string;
}

export class ApiError extends Error {
  status: number;
  code: string | undefined;
  body: unknown;
  constructor(status: number, body: unknown) {
    const b = (body ?? {}) as { error?: string; message?: string };
    super(b.message ?? b.error ?? `HTTP ${status}`);
    this.status = status;
    this.code = b.error;
    this.body = body;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === "string") headers.set("Content-Type", "application/json");
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });
const f = (serial: string) => `/api/fleet/${encodeURIComponent(serial)}`;

export const api = {
  fleet: () => call<FleetTerminal[]>("/api/fleet"),
  add: (ip: string) => call<FleetTerminal>("/api/fleet", json("POST", { ip })),
  scan: () => call<{ found: number; added: number }>("/api/fleet/scan", { method: "POST" }),
  rename: (serial: string, name: string) => call<FleetTerminal>(f(serial), json("PATCH", { name })),
  setBarrier: (serial: string, barrier: string | null) => call<FleetTerminal>(f(serial), json("PATCH", { barrier })),
  remove: (serial: string) => call<{ ok: boolean }>(f(serial), { method: "DELETE" }),
  diag: (serial: string) => call<Diag>(`${f(serial)}/diag`),
  connect: (serial: string, settings: Record<string, string>, auth: { otp?: string; barrier?: string }) =>
    call<{ status: string; restart?: boolean }>(`${f(serial)}/connect`, json("POST", { settings, ...auth })),
  ota: (serial: string, image: ArrayBuffer) =>
    call<{ status: string; bytes: number }>(`${f(serial)}/ota`, {
      method: "POST",
      body: image,
      headers: { "Content-Type": "application/octet-stream" },
    }),
  otaKey: () => call<OtaKey>("/api/ota/key"),
  otaGenerate: (overwrite: boolean) => call<OtaKey>("/api/ota/key", json("POST", { overwrite })),
  mock: (serial?: string) => call<MockState>(`/api/mock${serial ? `?terminal=${encodeURIComponent(serial)}` : ""}`),
  saveMock: (config: MockConfig) => call<MockConfig>("/api/mock/config", json("PUT", config)),
  clearEvents: () => call<{ ok: boolean }>("/api/mock/events", { method: "DELETE" }),
};

/** The terminal's own error text ({"status":"error","message":...}) if present. */
export function terminalMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const b = err.body as { message?: string } | null;
    return b?.message ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

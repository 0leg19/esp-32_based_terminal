// NFC Terminal Manager - local backend.
//
//   UI + API   http://127.0.0.1:5180  (loopback only)
//   test server https://0.0.0.0:8443/check_card, http://0.0.0.0:8090/check_card
//
//   node server/index.ts         development (Vite middleware, hot reload)
//   node server/index.ts --prod  serve the built UI from dist/

import http from "node:http";
import path from "node:path";

import express from "express";
import type { NextFunction, Request, Response } from "express";

import { HTTP_PORT, HTTPS_PORT, MockServer } from "./mock.ts";
import type { MockEvent } from "./mock.ts";
import { otaGenerateKeys, otaPublicKey, otaPublicKeyC, otaSign } from "./ota.ts";
import { Fleet, FleetError } from "./fleet.ts";
import { APP_ROOT } from "./store.ts";
import { TerminalError } from "./terminal.ts";

const PORT = Number(process.env.PORT ?? 5180);
const HOST = process.env.HOST ?? "127.0.0.1";
const PROD = process.argv.includes("--prod");

const mock = new MockServer();
await mock.start();
const fleet = new Fleet();
fleet.start();

const app = express();
app.disable("x-powered-by");

// DNS rebinding / cross-site protection: the API is for this UI only.
const allowedHosts = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!allowedHosts.has(String(req.headers.host))) {
    res.status(403).json({ error: "forbidden_host" });
    return;
  }
  const origin = req.headers.origin;
  if (origin && origin !== "null") {
    try {
      if (!allowedHosts.has(new URL(origin).host)) throw new Error();
    } catch {
      res.status(403).json({ error: "forbidden_origin" });
      return;
    }
  }
  next();
});

const api = express.Router();
api.use(express.json({ limit: "64kb" }));

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response) => {
  fn(req, res).catch((err: unknown) => {
    if (err instanceof FleetError) res.status(err.status).json({ error: err.code, message: err.message });
    else if (err instanceof TerminalError) res.status(err.code === "bad_ip" ? 400 : 502).json({ error: err.code, message: err.message });
    else res.status(500).json({ error: "internal", message: err instanceof Error ? err.message : String(err) });
  });
};

const serial = (req: Request) => String(req.params.serial);

// ---- fleet ----
api.get(
  "/fleet",
  wrap(async (_req, res) => {
    res.json(fleet.list());
  }),
);

api.post(
  "/fleet",
  wrap(async (req, res) => {
    res.json(await fleet.add(String(req.body?.ip ?? "").trim()));
  }),
);

api.post(
  "/fleet/scan",
  wrap(async (_req, res) => {
    res.json(await fleet.scan());
  }),
);

api.patch(
  "/fleet/:serial",
  wrap(async (req, res) => {
    const b = (req.body ?? {}) as { name?: unknown; barrier?: unknown };
    if (typeof b.name === "string") fleet.rename(serial(req), b.name);
    if (b.barrier !== undefined) await fleet.setBarrier(serial(req), typeof b.barrier === "string" ? b.barrier : null);
    res.json(fleet.get(serial(req)));
  }),
);

api.delete(
  "/fleet/:serial",
  wrap(async (req, res) => {
    fleet.remove(serial(req));
    res.json({ ok: true });
  }),
);

api.get(
  "/fleet/:serial/diag",
  wrap(async (req, res) => {
    res.json(await fleet.diag(serial(req)));
  }),
);

api.post(
  "/fleet/:serial/connect",
  wrap(async (req, res) => {
    const b = (req.body ?? {}) as { settings?: Record<string, unknown>; otp?: unknown; barrier?: unknown };
    const settings: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.settings ?? {})) if (typeof v === "string") settings[k] = v;
    const r = await fleet.connect(serial(req), settings, {
      otp: typeof b.otp === "string" ? b.otp : undefined,
      barrier: typeof b.barrier === "string" ? b.barrier : undefined,
    });
    res.status(r.status).json(r.body);
  }),
);

api.post(
  "/fleet/:serial/ota",
  express.raw({ type: "application/octet-stream", limit: "4mb" }),
  wrap(async (req, res) => {
    const image = req.body as Buffer;
    if (!Buffer.isBuffer(image) || image.length < 1024) {
      res.status(400).json({ error: "no_image" });
      return;
    }
    // ESP32 application images start with the magic byte 0xE9.
    if (image[0] !== 0xe9) {
      res.status(400).json({ error: "not_esp32_image" });
      return;
    }
    let signature: string;
    try {
      signature = otaSign(image);
    } catch {
      res.status(409).json({ error: "no_keys" });
      return;
    }
    const r = await fleet.ota(serial(req), image, signature);
    res.status(r.status).json(r.body);
  }),
);

// ---- OTA keys ----
api.get(
  "/ota/key",
  wrap(async (_req, res) => {
    const pem = otaPublicKey();
    res.json(pem ? { pem, c: otaPublicKeyC(pem) } : { pem: null });
  }),
);

api.post(
  "/ota/key",
  wrap(async (req, res) => {
    try {
      const pem = otaGenerateKeys(Boolean(req.body?.overwrite));
      res.json({ pem, c: otaPublicKeyC(pem) });
    } catch {
      res.status(409).json({ error: "keys_exist" });
    }
  }),
);

// ---- test server ----
api.get(
  "/mock",
  wrap(async (req, res) => {
    await mock.refresh();
    let terminal: string | undefined;
    if (typeof req.query.terminal === "string") {
      try {
        terminal = fleet.terminalIp(req.query.terminal);
      } catch {
        /* unknown serial: use the first LAN address */
      }
    }
    res.json({
      config: mock.config,
      urls: mock.urls(terminal),
      ports: { https: HTTPS_PORT, http: HTTP_PORT },
      listening: { https: mock.port("https") !== null, http: mock.port("http") !== null },
      errors: mock.listenErrors,
      caCert: mock.caCert,
      names: mock.names,
    });
  }),
);

api.put(
  "/mock/config",
  wrap(async (req, res) => {
    res.json(mock.setConfig(req.body ?? {}));
  }),
);

api.delete(
  "/mock/events",
  wrap(async (_req, res) => {
    mock.clearEvents();
    res.json({ ok: true });
  }),
);

// Server-sent events: history first, then live.
api.get("/mock/events", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  send("history", mock.events);
  const onEvent = (e: MockEvent) => send("event", e);
  const onCleared = () => send("history", []);
  mock.on("event", onEvent);
  mock.on("cleared", onCleared);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    mock.off("event", onEvent);
    mock.off("cleared", onCleared);
  });
});

app.use("/api", api);
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "not_found" });
});

const server = http.createServer(app);

if (PROD) {
  const dist = path.join(APP_ROOT, "dist");
  app.use(express.static(dist));
  app.use((_req: Request, res: Response) => res.sendFile(path.join(dist, "index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: APP_ROOT,
    appType: "spa",
    server: { middlewareMode: true, hmr: { server } },
  });
  app.use(vite.middlewares);
}

server.listen(PORT, HOST, () => {
  console.log(`NFC Terminal Manager  http://localhost:${PORT}`);
  const u = mock.urls();
  console.log(`Test server           ${u.https ?? "-"}  ${u.http ?? "-"}`);
  for (const e of mock.listenErrors) console.log(`  could not listen: ${e}`);
});

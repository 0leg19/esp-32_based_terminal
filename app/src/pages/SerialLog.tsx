// Serial log over USB with the Web Serial API (Chrome / Edge). Nothing goes
// through the backend: the browser talks to the USB-UART chip directly.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Card, Field, Notice } from "../components/ui.tsx";

interface PortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
}

interface SerialLike {
  requestPort(): Promise<PortLike>;
}

interface Line {
  id: number;
  time: string;
  text: string;
}

const MAX_LINES = 3000;
const serial = (navigator as Navigator & { serial?: SerialLike }).serial;

const TAG_COLOURS: Record<string, string> = {
  ETH: "text-cyan-300",
  WIFI: "text-cyan-300",
  NFC: "text-indigo-300",
  NET: "text-amber-300",
  API: "text-emerald-300",
  OTA: "text-emerald-300",
  BOOT: "text-fuchsia-300",
  SYS: "text-fuchsia-300",
  CFG: "text-fuchsia-300",
};

function tag(text: string): string {
  const m = /^\[([A-Z]+)\]/.exec(text);
  return (m && TAG_COLOURS[m[1]]) ?? "";
}

export default function SerialLog() {
  const { t } = useTranslation();
  const [lines, setLines] = useState<Line[]>([]);
  const [connected, setConnected] = useState(false);
  const [baud, setBaud] = useState(115200);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const port = useRef<PortLike | null>(null);
  const reader = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const nextId = useRef(1);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);

  useEffect(
    () => () => {
      void reader.current?.cancel();
      void port.current?.close().catch(() => undefined);
    },
    [],
  );

  const append = (text: string) =>
    setLines((l) => [...l.slice(-(MAX_LINES - 1)), { id: nextId.current++, time: new Date().toLocaleTimeString(), text }]);

  const readLoop = async (p: PortLike) => {
    const decoder = new TextDecoder();
    let buffer = "";
    while (p.readable) {
      const r = p.readable.getReader();
      reader.current = r;
      try {
        for (;;) {
          const { value, done } = await r.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\r?\n/);
          buffer = parts.pop() ?? "";
          for (const part of parts) append(part.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, ""));
        }
      } catch {
        return;
      } finally {
        r.releaseLock();
      }
    }
  };

  const connect = async () => {
    if (!serial) return;
    setError(null);
    try {
      const p = await serial.requestPort();
      await p.open({ baudRate: baud });
      // Keep EN and GPIO0 released (auto-reset circuit on DevKit boards).
      await p.setSignals({ dataTerminalReady: false, requestToSend: false });
      port.current = p;
      setConnected(true);
      void readLoop(p).finally(() => setConnected(false));
    } catch (e) {
      if (e instanceof Error && e.name !== "NotFoundError") setError(e.message);
    }
  };

  const disconnect = async () => {
    await reader.current?.cancel().catch(() => undefined);
    await port.current?.close().catch(() => undefined);
    port.current = null;
    setConnected(false);
  };

  const reset = async () => {
    const p = port.current;
    if (!p) return;
    await p.setSignals({ dataTerminalReady: false, requestToSend: true });
    await new Promise((r) => setTimeout(r, 120));
    await p.setSignals({ dataTerminalReady: false, requestToSend: false });
  };

  const shown = filter ? lines.filter((l) => l.text.toLowerCase().includes(filter.toLowerCase())) : lines;

  if (!serial) return <Notice tone="warn">{t("serial.unsupported")}</Notice>;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t("serial.baud")}>
            <select value={baud} disabled={connected} onChange={(e) => setBaud(Number(e.target.value))}>
              {[115200, 74880, 230400, 460800, 921600].map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          {connected ? (
            <>
              <Button onClick={() => void disconnect()}>
                {t("serial.disconnect")}
              </Button>
              <Button onClick={() => void reset()}>
                {t("serial.reset")}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={() => void connect()}>
              {t("serial.connect")}
            </Button>
          )}
          <Field label={t("serial.filter")}>
            <input value={filter} dir="ltr" placeholder="[ETH]" onChange={(e) => setFilter(e.target.value)} />
          </Field>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
            {t("serial.follow")}
          </label>
          <Button variant="ghost" onClick={() => setLines([])}>
            {t("common.clear")}
          </Button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{t("serial.hint")}</p>
        {error && <Notice tone="error">{error}</Notice>}
      </Card>
      <div className="h-[62vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-start font-mono text-xs text-slate-200" ref={box} dir="ltr">
        {shown.length === 0 ? (
          <span className="text-slate-500 dark:text-slate-400">{connected ? t("serial.waiting") : t("serial.notConnected")}</span>
        ) : (
          shown.map((l) => (
            <div key={l.id} className={tag(l.text)}>
              <span className="text-slate-500">{l.time}</span> {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

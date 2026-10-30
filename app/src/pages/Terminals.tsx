import { CheckCircle2, Loader2, MinusCircle, Plus, Radar, RefreshCw, Search, Settings2, Trash2, Upload, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, terminalMessage } from "../api.ts";
import type { FleetTerminal } from "../api.ts";
import { EMPTY_SETTINGS, Errors, ServerFields, settingsBody, validateSettings } from "../components/settings.tsx";
import type { Settings } from "../components/settings.tsx";
import { Badge, Button, Card, Field, Muted, Notice, RelativeTime, StatusLabel, Table, cx } from "../components/ui.tsx";
import { displayName, health, useFleet } from "../fleet.tsx";
import { href } from "../nav.ts";

type RunState = { state: "pending" | "running" | "ok" | "error" | "skipped"; text?: string };
type Results = Record<string, RunState>;

/** Why a bulk operation cannot use this terminal, or null. */
function blocker(t: FleetTerminal): string | null {
  if (!t.online) return "offline";
  if (t.info?.connection_status !== "connected") return "notConfigured";
  if (!t.hasBarrier) return "noBarrier";
  if (t.barrierOk === false) return "barrierRejected";
  return null;
}

function ResultList({ results, terminals }: { results: Results; terminals: FleetTerminal[] }) {
  const { t } = useTranslation();
  const icon = (s: RunState["state"]) =>
    s === "ok" ? (
      <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
    ) : s === "error" ? (
      <XCircle size={16} className="text-red-600 dark:text-red-400" />
    ) : s === "running" ? (
      <Loader2 size={16} className="animate-spin text-cyan-600" />
    ) : (
      <MinusCircle size={16} className="text-slate-400" />
    );
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {Object.entries(results).map(([serial, r]) => {
        const term = terminals.find((x) => x.serial === serial);
        return (
          <li key={serial} className="flex flex-wrap items-center gap-2">
            {icon(r.state)}
            <strong>{term ? displayName(term) : serial}</strong>
            <Muted>{r.text ?? t(`terminals.run.${r.state}`)}</Muted>
          </li>
        );
      })}
    </ul>
  );
}

async function runEach(serials: string[], terminals: FleetTerminal[], set: (r: Results) => void, t: (k: string) => string, fn: (serial: string) => Promise<string>) {
  const results: Results = {};
  for (const s of serials) {
    const term = terminals.find((x) => x.serial === s);
    const block = term ? blocker(term) : "offline";
    results[s] = block ? { state: "skipped", text: t(`terminals.blocked.${block}`) } : { state: "pending" };
  }
  set({ ...results });
  for (const s of serials) {
    if (results[s].state === "skipped") continue;
    results[s] = { state: "running" };
    set({ ...results });
    try {
      results[s] = { state: "ok", text: await fn(s) };
    } catch (e) {
      results[s] = { state: "error", text: terminalMessage(e) };
    }
    set({ ...results });
  }
}

function BulkPanel({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40">{children}</div>;
}

function BulkConfigure({ serials, onDone }: { serials: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const { terminals, refresh } = useFleet();
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [errors, setErrors] = useState<string[]>([]);
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    const errs = validateSettings(settings, false);
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    await runEach(serials, terminals, setResults, t, async (s) => {
      await api.connect(s, settingsBody(settings), {});
      return t("terminals.run.saved");
    });
    setBusy(false);
    void refresh();
  };

  return (
    <BulkPanel>
      <Notice tone="info">{t("terminals.bulkConfigureHint")}</Notice>
      <ServerFields value={settings} onChange={setSettings} barrierHint={t("terminals.keepBarrierHint")} />
      <Errors errors={errors} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy} onClick={() => void apply()}>
          {t("terminals.applyTo", { n: serials.length })}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("common.close")}
        </Button>
      </div>
      {results && <ResultList results={results} terminals={terminals} />}
    </BulkPanel>
  );
}

function BulkUpdate({ serials, onDone }: { serials: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const { terminals, refresh } = useFleet();
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!file) return;
    setBusy(true);
    const image = await file.arrayBuffer();
    await runEach(serials, terminals, setResults, t, async (s) => {
      const r = await api.ota(s, image);
      return t("firmware.uploaded", { bytes: r.bytes });
    });
    setBusy(false);
    void refresh();
  };

  return (
    <BulkPanel>
      <Notice tone="info">{t("terminals.bulkUpdateHint")}</Notice>
      <Field label={t("firmware.file")} hint={file ? `${file.name} · ${file.size.toLocaleString()} B` : undefined}>
        <input type="file" accept=".bin,application/octet-stream" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={busy || !file} onClick={() => void start()}>
          {t("terminals.updateN", { n: serials.length })}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t("common.close")}
        </Button>
      </div>
      {results && <ResultList results={results} terminals={terminals} />}
    </BulkPanel>
  );
}

const KPI_ACCENT = {
  total: "bg-cyan-500",
  online: "bg-emerald-500",
  attention: "bg-amber-500",
  offline: "bg-red-500",
} as const;

export default function Terminals() {
  const { t } = useTranslation();
  const { terminals, loaded, refresh } = useFleet();
  const [query, setQuery] = useState("");
  const [ip, setIp] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<"configure" | "update" | null>(null);
  const [busy, setBusy] = useState<"scan" | "add" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "warn"; text: string } | null>(null);

  const counts = useMemo(() => {
    const c = { total: terminals.length, online: 0, offline: 0, attention: 0 };
    for (const term of terminals) {
      const h = health(term);
      if (h === "online") c.online++;
      else if (h === "offline") c.offline++;
      else if (h === "attention") c.attention++;
    }
    return c;
  }, [terminals]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return terminals;
    return terminals.filter((x) => [x.name, x.ip, x.serial, x.info?.software_version ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [terminals, query]);

  const selectedList = [...selected].filter((s) => terminals.some((x) => x.serial === s));
  const allShown = shown.length > 0 && shown.every((x) => selected.has(x.serial));

  const toggle = (serial: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(serial)) n.delete(serial);
      else n.add(serial);
      return n;
    });

  const scan = async () => {
    setBusy("scan");
    setMessage(null);
    try {
      const r = await api.scan();
      setMessage({ tone: r.found ? "ok" : "warn", text: r.found ? t("terminals.scanResult", { found: r.found, added: r.added }) : t("terminals.noneFound") });
      await refresh();
    } catch (e) {
      setMessage({ tone: "error", text: terminalMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    const addr = ip.trim();
    if (!addr) return;
    setBusy("add");
    setMessage(null);
    try {
      const term = await api.add(addr);
      setMessage({ tone: "ok", text: t("terminals.added", { name: displayName(term) }) });
      setIp("");
      await refresh();
    } catch (e) {
      setMessage({ tone: "error", text: t("terminals.notReachable", { ip: addr, reason: terminalMessage(e) }) });
    } finally {
      setBusy(null);
    }
  };

  const removeSelected = async () => {
    if (!window.confirm(t("terminals.confirmRemove", { n: selectedList.length }))) return;
    for (const s of selectedList) await api.remove(s).catch(() => undefined);
    setSelected(new Set());
    await refresh();
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["total", "online", "attention", "offline"] as const).map((k) => (
          <div key={k} className="relative overflow-hidden rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <span aria-hidden className={cx("absolute inset-x-0 top-0 h-1", KPI_ACCENT[k])} />
            <div className="text-3xl font-bold tabular-nums">{counts[k]}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">{t(`terminals.kpi.${k}`)}</div>
          </div>
        ))}
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <label className="flex max-w-sm flex-[1_1_16rem] items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 text-slate-400 focus-within:outline-2 focus-within:outline-cyan-500 dark:border-slate-700 dark:bg-slate-900">
            <Search size={16} aria-hidden />
            <input value={query} placeholder={t("terminals.search")} onChange={(e) => setQuery(e.target.value)} className="!border-0 !bg-transparent !px-0 focus-visible:!outline-none" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={ip}
              dir="ltr"
              inputMode="decimal"
              placeholder="192.168.1.50"
              className="!w-40"
              onChange={(e) => setIp(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void add()}
            />
            <Button disabled={busy !== null || !ip.trim()} onClick={() => void add()}>
              <Plus size={16} aria-hidden /> {t("terminals.add")}
            </Button>
            <Button variant="primary" disabled={busy !== null} onClick={() => void scan()}>
              {busy === "scan" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Radar size={16} aria-hidden />}
              {busy === "scan" ? t("terminals.scanning") : t("terminals.scan")}
            </Button>
          </div>
        </div>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        {selectedList.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-2 dark:border-cyan-500/40 dark:bg-cyan-500/10">
            <strong className="me-2 text-sm">{t("terminals.selected", { n: selectedList.length })}</strong>
            <Button variant={panel === "configure" ? "primary" : "default"} onClick={() => setPanel(panel === "configure" ? null : "configure")}>
              <Settings2 size={16} aria-hidden /> {t("terminals.bulkConfigure")}
            </Button>
            <Button variant={panel === "update" ? "primary" : "default"} onClick={() => setPanel(panel === "update" ? null : "update")}>
              <Upload size={16} aria-hidden /> {t("terminals.bulkUpdate")}
            </Button>
            <Button variant="danger" onClick={() => void removeSelected()}>
              <Trash2 size={16} aria-hidden /> {t("terminals.remove")}
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              {t("terminals.clearSelection")}
            </Button>
          </div>
        )}
        {panel === "configure" && selectedList.length > 0 && <BulkConfigure serials={selectedList} onDone={() => setPanel(null)} />}
        {panel === "update" && selectedList.length > 0 && <BulkUpdate serials={selectedList} onDone={() => setPanel(null)} />}

        {!loaded ? (
          <Muted>{t("common.loading")}</Muted>
        ) : terminals.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center text-slate-500">
            <Radar size={40} aria-hidden className="text-slate-400" />
            <p>{t("terminals.empty")}</p>
          </div>
        ) : (
          <Table className="[&_td]:whitespace-nowrap [&_th]:caps:uppercase [&_th]:caps:tracking-wider">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" aria-label={t("terminals.selectAll")} checked={allShown} onChange={() => setSelected(allShown ? new Set() : new Set(shown.map((x) => x.serial)))} />
                </th>
                <th>{t("terminals.col.status")}</th>
                <th>{t("terminals.col.name")}</th>
                <th>IP</th>
                <th>{t("terminals.col.firmware")}</th>
                <th>NFC</th>
                <th>{t("terminals.col.config")}</th>
                <th>{t("terminals.col.server")}</th>
                <th>{t("terminals.col.lastSeen")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((term) => {
                const h = health(term);
                const isSelected = selected.has(term.serial);
                const stale = term.online === false ? "opacity-50" : undefined;
                return (
                  <tr key={term.serial} className={cx("transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50", isSelected && "bg-cyan-50/70 dark:bg-cyan-500/10")}>
                    <td>
                      <input type="checkbox" aria-label={displayName(term)} checked={isSelected} onChange={() => toggle(term.serial)} />
                    </td>
                    <td>
                      <StatusLabel health={h}>{t(`terminals.health.${h}`)}</StatusLabel>
                    </td>
                    <td>
                      <a href={href({ page: "terminal", serial: term.serial, tab: "overview" })} className="font-semibold text-slate-900 no-underline hover:text-cyan-700 hover:underline dark:text-slate-100 dark:hover:text-cyan-300">
                        {displayName(term)}
                      </a>
                      <div dir="ltr" className="font-mono text-xs text-slate-500">
                        {term.serial}
                      </div>
                    </td>
                    <td dir="ltr" className="font-mono">
                      {term.ip}
                    </td>
                    <td dir="ltr" className={stale}>
                      {term.info?.software_version ?? "—"}
                    </td>
                    <td className={stale}>{term.info ? <Badge tone={term.info.nfc_status === "ready" ? "ok" : "error"}>{term.info.nfc_status === "ready" ? t("terminals.ok") : t("terminals.error")}</Badge> : "—"}</td>
                    <td className={stale}>
                      {term.info ? (
                        <Badge tone={term.info.connection_status === "connected" ? "ok" : "warn"}>
                          {term.info.connection_status === "connected" ? t("terminals.configured") : t("terminals.notConfigured")}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={stale}>
                      {term.diag?.server_reachable === undefined ? (
                        <Muted small>{term.hasBarrier ? "—" : t("terminals.noBarrierShort")}</Muted>
                      ) : (
                        <Badge tone={term.diag.server_reachable ? "ok" : "error"}>{term.diag.server_reachable ? t("terminals.reachable") : t("terminals.unreachable")}</Badge>
                      )}
                    </td>
                    <td className="text-xs">
                      <RelativeTime iso={term.lastSeen} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        {terminals.length > 0 && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <RefreshCw size={13} aria-hidden /> {t("terminals.autoRefresh")}
          </p>
        )}
      </Card>
    </div>
  );
}

import { ArrowLeft, Check, Cpu, KeyRound, Network, Pencil, RefreshCw, Server, Trash2, Wifi } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { ApiError, api, terminalMessage } from "../api.ts";
import type { FleetTerminal } from "../api.ts";
import { EMPTY_SETTINGS, Errors, ServerFields, WifiFields, settingsBody, validateSettings } from "../components/settings.tsx";
import type { Settings } from "../components/settings.tsx";
import { Badge, Button, Card, Field, IconButton, KeyValues, Muted, Notice, RelativeTime, Secret, Segmented, StatusLabel, cx, formatUptime } from "../components/ui.tsx";
import type { Tone } from "../components/ui.tsx";
import { displayName, health, useFleet } from "../fleet.tsx";
import { TABS, go, href } from "../nav.ts";
import type { Tab } from "../nav.ts";

const STACK_WARN = 500;
const STATS = [
  "polls",
  "poll_hits",
  "cards_admitted",
  "cards_busy",
  "requests",
  "http_200",
  "http_401_403",
  "http_other",
  "conn_errors",
  "last_latency_ms",
  "max_latency_ms",
  "nfc_reinits",
  "net_restarts",
  "server_probes",
] as const;

// ---------- header ----------

function NameEditor({ term }: { term: FleetTerminal }) {
  const { t } = useTranslation();
  const { replace } = useFleet();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(term.name);

  const save = async () => {
    setEditing(false);
    if (name.trim() === term.name) return;
    replace(await api.rename(term.serial, name));
  };

  if (!editing) {
    return (
      <h1 className="flex items-center gap-1.5 text-2xl font-bold tracking-tight">
        {displayName(term)}
        <IconButton aria-label={t("terminal.rename")} onClick={() => setEditing(true)}>
          <Pencil size={16} />
        </IconButton>
      </h1>
    );
  }
  return (
    <form
      className="flex max-w-md items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <input
        autoFocus
        value={name}
        maxLength={64}
        placeholder={t("terminal.namePlaceholder")}
        className="!py-1 !text-xl !font-bold"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void save()}
      />
      <IconButton type="submit" aria-label={t("common.save")}>
        <Check size={18} />
      </IconButton>
    </form>
  );
}

// ---------- overview ----------

const TILE: Record<Tone, string> = {
  ok: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  error: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  info: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300",
  muted: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

function StateTile({ icon: Icon, label, tone, value }: { icon: LucideIcon; label: string; tone: Tone; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <span className={cx("flex-none rounded-lg p-2", TILE[tone])}>
        <Icon size={20} aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
        <div className="truncate font-bold">{value}</div>
      </div>
    </div>
  );
}

function BarrierCard({ term }: { term: FleetTerminal }) {
  const { t } = useTranslation();
  const { replace } = useFleet();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (barrier: string | null) => {
    setBusy(true);
    setError(null);
    try {
      replace(await api.setBarrier(term.serial, barrier));
      setValue("");
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setError(code && ["wrong_barrier", "locked", "not_configured"].includes(code) ? t(`terminal.barrierErrors.${code}`) : terminalMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const state = !term.hasBarrier ? "missing" : term.barrierOk === false ? "rejected" : "saved";
  return (
    <Card title={t("terminal.barrierTitle")}>
      <Notice tone={state === "saved" ? "ok" : state === "rejected" ? "error" : "info"}>{t(`terminal.barrierState.${state}`)}</Notice>
      <div className="flex flex-wrap items-end gap-2">
        <Field className="flex-[1_1_16rem]" label={term.hasBarrier ? t("terminal.barrierReplace") : t("terminal.barrierEnter")} hint={t("terminal.barrierHint")}>
          <Secret value={value} onChange={setValue} />
        </Field>
        <div className="flex gap-2 pb-6">
          <Button variant="primary" disabled={busy || !value} onClick={() => void save(value)}>
            {t("terminal.barrierSave")}
          </Button>
          {term.hasBarrier && (
            <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
              {t("terminal.barrierForget")}
            </Button>
          )}
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </Card>
  );
}

function Overview({ term }: { term: FleetTerminal }) {
  const { t } = useTranslation();
  const { refresh } = useFleet();
  const info = term.info;
  const d = term.diag;

  const remove = async () => {
    if (!window.confirm(t("terminals.confirmRemove", { n: 1 }))) return;
    await api.remove(term.serial);
    await refresh();
    go({ page: "terminals" });
  };

  const fields: [string, string | undefined][] = [
    ["serial_number", term.serial],
    ["ip_address", term.ip],
    ["software_version", info?.software_version],
    ["model", info?.model],
    ["connection", info?.connection],
    ["provisioning", info?.provisioning],
    ["unique_number", info?.unique_number],
    ["creator", info?.creator],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StateTile icon={Network} label={t("terminal.tiles.network")} tone={term.online ? "ok" : "error"} value={term.online ? t("terminals.health.online") : t("terminals.health.offline")} />
        <StateTile icon={Cpu} label={t("terminal.tiles.nfc")} tone={info?.nfc_status === "ready" ? "ok" : info ? "error" : "muted"} value={info?.nfc_status === "ready" ? t("terminals.ok") : info ? t("terminals.error") : "—"} />
        <StateTile
          icon={Wifi}
          label={t("terminal.tiles.config")}
          tone={info?.connection_status === "connected" ? "ok" : info ? "warn" : "muted"}
          value={info?.connection_status === "connected" ? t("terminals.configured") : info ? t("terminals.notConfigured") : "—"}
        />
        <StateTile
          icon={Server}
          label={t("terminal.tiles.server")}
          tone={d?.server_reachable === undefined ? "muted" : d.server_reachable ? "ok" : "error"}
          value={d?.server_reachable === undefined ? t("terminals.noBarrierShort") : d.server_reachable ? t("terminals.reachable") : t("terminals.unreachable")}
        />
      </div>

      <Card title={t("terminal.identity")}>
        <KeyValues
          rows={[
            ...fields.map(([k, v]): [string, React.ReactNode] => [t(`terminal.fields.${k}`), <span dir="ltr">{v ?? "—"}</span>]),
            [t("terminal.lastSeen"), <RelativeTime iso={term.lastSeen} />],
            ...(d ? [[t("diagnostics.uptime"), <span dir="ltr">{formatUptime(d.uptime_s)}</span>] as [string, React.ReactNode]] : []),
          ]}
        />
      </Card>

      <BarrierCard term={term} />

      <div>
        <Button variant="danger" onClick={() => void remove()}>
          <Trash2 size={16} aria-hidden /> {t("terminal.remove")}
        </Button>
      </div>
    </div>
  );
}

// ---------- configuration ----------

type AuthMode = "saved" | "typed" | "otp";

function Configure({ term }: { term: FleetTerminal }) {
  const { t } = useTranslation();
  const { refresh } = useFleet();
  const configured = term.info?.connection_status === "connected";
  const savedUsable = term.hasBarrier && term.barrierOk !== false;
  const [mode, setMode] = useState<AuthMode>(!configured ? "otp" : savedUsable ? "saved" : "typed");
  const [otp, setOtp] = useState("");
  const [current, setCurrent] = useState("");
  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const errs = validateSettings(settings, mode === "otp");
    if (mode === "otp" && !/^\d{6}$/.test(otp)) errs.push("otp");
    if (mode === "typed" && !current) errs.push("currentBarrier");
    setErrors(errs);
    if (errs.length) return;
    setBusy(true);
    setResult(null);
    try {
      const auth = mode === "otp" ? { otp } : mode === "typed" ? { barrier: current } : {};
      const r = await api.connect(term.serial, settingsBody(settings), auth);
      setOtp("");
      setCurrent("");
      setResult({ tone: "ok", text: r.restart ? t("configure.savedRestart") : t("configure.saved") });
    } catch (e) {
      setResult({ tone: "error", text: t("configure.failed", { reason: terminalMessage(e) }) });
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  const modes: AuthMode[] = savedUsable ? ["saved", "typed", "otp"] : ["typed", "otp"];

  return (
    <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
      <Card title={t("configure.auth")}>
        <Segmented value={mode} onChange={setMode} options={modes.map((m) => ({ value: m, label: t(`configure.authModes.${m}`) }))} />
        {mode === "otp" && (
          <>
            <Notice tone="info">{t("configure.otpHelp")}</Notice>
            <Field label={t("configure.otp")}>
              <input
                value={otp}
                dir="ltr"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                className="!max-w-48 font-mono !text-2xl tracking-[0.3em]"
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </>
        )}
        {mode === "typed" && (
          <Field label={t("configure.currentBarrier")}>
            <Secret value={current} onChange={setCurrent} />
          </Field>
        )}
        {mode === "saved" && <p className="text-sm text-slate-500 dark:text-slate-400">{t("configure.savedBarrierHint")}</p>}
      </Card>

      <ServerFields value={settings} onChange={setSettings} serial={term.serial} barrierHint={mode === "otp" ? undefined : t("terminals.keepBarrierHint")} />
      <WifiFields value={settings} onChange={setSettings} />

      <Errors errors={errors} />
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      <div>
        <Button type="submit" variant="primary" disabled={busy || !term.online}>
          {busy ? t("common.sending") : t("configure.send")}
        </Button>
      </div>
    </form>
  );
}

// ---------- diagnostics ----------

function Diagnostics({ term }: { term: FleetTerminal }) {
  const { t, i18n } = useTranslation();
  const { refresh } = useFleet();
  const [error, setError] = useState<string | null>(null);
  const nf = new Intl.NumberFormat(i18n.resolvedLanguage);
  const d = term.diag;

  const now = async () => {
    try {
      await api.diag(term.serial);
      setError(null);
      await refresh();
    } catch (e) {
      setError(terminalMessage(e));
    }
  };

  if (!term.hasBarrier || term.barrierOk === false) {
    return (
      <Notice tone="info">
        {t("diagnostics.needBarrier")}{" "}
        <a className="font-semibold underline" href={href({ page: "terminal", serial: term.serial, tab: "overview" })}>
          {t("terminal.tabs.overview")}
        </a>
      </Notice>
    );
  }
  if (!d) return <Muted>{t("common.loading")}</Muted>;

  const flags = [
    ["link", d.link_up],
    ["ip", d.net_up],
    ["server", d.server_reachable],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={t("diagnostics.state")}
        actions={
          <>
            <Muted small>
              <RelativeTime iso={term.diagAt} />
            </Muted>
            <Button size="sm" onClick={() => void now()}>
              <RefreshCw size={13} aria-hidden /> {t("common.refresh")}
            </Button>
          </>
        }
      >
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex flex-wrap gap-1.5">
          {flags.map(([k, v]) =>
            v === undefined ? null : (
              <Badge key={k} tone={v ? "ok" : "error"}>
                {t(`diagnostics.${k}`)}: {v ? t("common.yes") : t("common.no")}
              </Badge>
            ),
          )}
        </div>
        <KeyValues
          rows={[
            [t("diagnostics.uptime"), <span dir="ltr">{formatUptime(d.uptime_s)}</span>],
            [t("diagnostics.heap"), `${nf.format(d.heap_free)} B (${t("diagnostics.heapMin")} ${nf.format(d.heap_min_free)} B)`],
            [t("diagnostics.latch"), d.latch_k],
          ]}
        />
      </Card>

      <Card title={t("diagnostics.counters")}>
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2.5">
          {STATS.filter((k) => k in d.stats).map((k) => (
            <div key={k} className="rounded-lg bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
              <dt className="text-xs text-slate-500 dark:text-slate-400">{t(`diagnostics.stats.${k}`)}</dt>
              <dd className="text-xl font-bold tabular-nums">{nf.format(d.stats[k])}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={t("diagnostics.stacks")}>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("diagnostics.stacksHint", { n: STACK_WARN })}</p>
        <div className="flex flex-col gap-2">
          {Object.entries(d.stack_free_bytes).map(([task, free]) => (
            <div key={task} className="grid grid-cols-[3.5rem_1fr_6rem] items-center gap-3 text-sm">
              <span dir="ltr" className="font-mono">
                {task}
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <span className={cx("block h-full rounded-full", free < STACK_WARN ? "bg-red-500" : "bg-emerald-500")} style={{ inlineSize: `${Math.min(100, (free / 4096) * 100)}%` }} />
              </span>
              <span className="text-end tabular-nums">{nf.format(free)} B</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------- firmware ----------

function Firmware({ term }: { term: FleetTerminal }) {
  const { t } = useTranslation();
  const { refresh } = useFleet();
  const [file, setFile] = useState<File | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    api.otaKey().then(
      (k) => setHasKey(Boolean(k.pem)),
      () => setHasKey(false),
    );
  }, []);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api.ota(term.serial, await file.arrayBuffer());
      setResult({ tone: "ok", text: t("firmware.uploaded", { bytes: r.bytes }) });
      void refresh();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      const known = code && ["no_keys", "not_esp32_image", "no_image", "no_barrier", "barrier_rejected"].includes(code);
      setResult({ tone: "error", text: known ? t(`firmware.errors.${code}`) : t("firmware.failed", { reason: terminalMessage(e) }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title={t("firmware.installed")}>
        <KeyValues
          rows={[
            [t("terminal.fields.software_version"), <span dir="ltr">{term.info?.software_version ?? "—"}</span>],
            [t("terminal.fields.model"), <span dir="ltr">{term.info?.model ?? "—"}</span>],
          ]}
        />
      </Card>
      <Card title={t("firmware.update")}>
        {hasKey === false && (
          <Notice tone="warn">
            {t("firmware.errors.no_keys")}{" "}
            <a className="font-semibold underline" href={href({ page: "signing" })}>
              {t("nav.signing")}
            </a>
          </Notice>
        )}
        {(!term.hasBarrier || term.barrierOk === false) && <Notice tone="warn">{t("firmware.errors.no_barrier")}</Notice>}
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("firmware.updateHint")}</p>
        <Field label={t("firmware.file")} hint={file ? `${file.name} · ${file.size.toLocaleString()} B` : undefined}>
          <input type="file" accept=".bin,application/octet-stream" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        {result && <Notice tone={result.tone}>{result.text}</Notice>}
        <div>
          <Button variant="primary" disabled={busy || !file || !hasKey || !term.online} onClick={() => void upload()}>
            {busy ? t("firmware.uploading") : t("firmware.upload")}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ---------- page ----------

const TAB_ICONS: Record<Tab, LucideIcon> = { overview: Network, configure: Wifi, diagnostics: Cpu, firmware: KeyRound };
const BODIES: Record<Tab, (p: { term: FleetTerminal }) => React.JSX.Element> = { overview: Overview, configure: Configure, diagnostics: Diagnostics, firmware: Firmware };

export default function Terminal({ serial, tab }: { serial: string; tab: Tab }) {
  const { t } = useTranslation();
  const { find, loaded } = useFleet();
  const term = find(serial);

  const back = (
    <a href={href({ page: "terminals" })} className="inline-flex items-center gap-1.5 self-start text-sm text-slate-500 no-underline hover:text-cyan-700 dark:hover:text-cyan-300">
      <ArrowLeft size={16} aria-hidden className="rtl:-scale-x-100" /> {t("terminal.back")}
    </a>
  );

  if (!term) {
    return loaded ? (
      <div className="flex flex-col gap-4">
        {back}
        <Notice tone="warn">{t("terminal.notFound")}</Notice>
      </div>
    ) : (
      <Muted>{t("common.loading")}</Muted>
    );
  }

  const h = health(term);
  const Body = BODIES[tab];

  return (
    <div className="flex flex-col gap-4">
      {back}
      <header>
        <NameEditor key={term.name} term={term} />
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <StatusLabel health={h}>{t(`terminals.health.${h}`)}</StatusLabel>
          <span dir="ltr" className="font-mono">
            {term.ip}
          </span>
          <span dir="ltr" className="font-mono text-slate-500">
            {term.serial}
          </span>
          {term.info?.software_version && <Muted>v{term.info.software_version}</Muted>}
        </div>
      </header>

      {term.online === false && <Notice tone="error">{t("terminal.offline", { ip: term.ip })}</Notice>}
      {term.barrierOk === false && <Notice tone="warn">{t("terminal.barrierState.rejected")}</Notice>}

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" aria-label={t("terminal.sections")}>
        {TABS.map((id) => {
          const Icon = TAB_ICONS[id];
          const active = id === tab;
          return (
            <a
              key={id}
              href={href({ page: "terminal", serial, tab: id })}
              aria-current={active ? "page" : undefined}
              className={cx(
                "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm no-underline",
                active ? "border-cyan-500 font-semibold text-cyan-700 dark:text-cyan-300" : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-100",
              )}
            >
              <Icon size={16} aria-hidden /> {t(`terminal.tabs.${id}`)}
            </a>
          );
        })}
      </nav>

      <Body term={term} />
    </div>
  );
}

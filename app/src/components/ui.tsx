import { useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type Tone = "ok" | "warn" | "error" | "info" | "muted";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ---------- buttons ----------

type Variant = "default" | "primary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  default:
    "border-slate-300 bg-white text-slate-800 hover:border-cyan-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:border-cyan-400",
  primary: "border-cyan-600 bg-cyan-600 font-semibold text-white hover:bg-cyan-700 dark:border-cyan-400 dark:bg-cyan-400 dark:text-slate-950 dark:hover:bg-cyan-300",
  ghost: "border-transparent bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
  danger: "border-slate-300 bg-white text-red-700 hover:border-red-500 dark:border-slate-700 dark:bg-slate-900 dark:text-red-400",
};

export function Button({
  variant = "default",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3.5 py-2 text-sm",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function IconButton({ className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx("inline-flex items-center justify-center rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-cyan-700 dark:hover:bg-slate-800 dark:hover:text-cyan-300", className)}
      {...rest}
    />
  );
}

// ---------- containers ----------

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

// ---------- status ----------

const BADGE: Record<Tone, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  error: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  info: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300",
  muted: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", BADGE[tone])}>{children}</span>;
}

const NOTICE: Record<Tone, string> = {
  ok: "border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200",
  warn: "border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
  error: "border-red-500 bg-red-50 text-red-900 dark:bg-red-500/10 dark:text-red-200",
  info: "border-cyan-500 bg-cyan-50 text-cyan-900 dark:bg-cyan-500/10 dark:text-cyan-200",
  muted: "border-slate-400 bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function Notice({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className={cx("rounded-lg border-s-4 px-3.5 py-2.5 text-sm", NOTICE[tone])} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export type Health = "online" | "offline" | "attention" | "unknown";

const DOT: Record<Health, string> = {
  online: "bg-emerald-500 ring-emerald-500/20",
  attention: "bg-amber-500 ring-amber-500/20",
  offline: "bg-red-500 ring-red-500/20",
  unknown: "bg-slate-400 ring-slate-400/20",
};

const HEALTH_TEXT: Record<Health, string> = {
  online: "text-emerald-700 dark:text-emerald-400",
  attention: "text-amber-700 dark:text-amber-400",
  offline: "text-red-700 dark:text-red-400",
  unknown: "text-slate-500",
};

export function Dot({ health }: { health: Health }) {
  return <span aria-hidden className={cx("inline-block size-2.5 flex-none rounded-full ring-4", DOT[health])} />;
}

export function StatusLabel({ health, children }: { health: Health; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold", HEALTH_TEXT[health])}>
      <Dot health={health} />
      {children}
    </span>
  );
}

// ---------- inputs ----------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <label
          key={o.value}
          className={cx(
            "inline-flex cursor-pointer items-center gap-2 rounded-lg border bg-white dark:bg-slate-900",
            size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-2 text-sm",
            o.value === value ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10" : "border-slate-300 dark:border-slate-700",
          )}
        >
          <input type="radio" checked={o.value === value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function Secret({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-1.5">
      <input type={show ? "text" : "password"} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false} dir="ltr" onChange={(e) => onChange(e.target.value)} />
      <Button size="sm" onClick={() => setShow((s) => !s)}>
        {show ? t("common.hide") : t("common.show")}
      </Button>
    </div>
  );
}

// ---------- code ----------

export function CopyButton({ text, dark }: { text: string; dark?: boolean }) {
  const { t } = useTranslation();
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      className={dark ? "border-white/20 bg-white/10 text-slate-100 hover:border-white/40 dark:bg-white/10" : undefined}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? t("common.copied") : t("common.copy")}
    </Button>
  );
}

export function Code({ children, copy = true }: { children: string; copy?: boolean }) {
  return (
    <div className="relative">
      {copy && (
        <div className="absolute end-2 top-2">
          <CopyButton text={children} dark />
        </div>
      )}
      <pre dir="ltr" className="overflow-x-auto rounded-lg bg-slate-950 p-4 text-start font-mono text-xs leading-relaxed text-slate-200">
        <code>{children}</code>
      </pre>
    </div>
  );
}

// ---------- data ----------

export function KeyValues({ rows }: { rows: [ReactNode, ReactNode, boolean?][] }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-x-5 gap-y-3">
      {rows.map(([k, v, wide], i) => (
        <div key={i} className={wide ? "col-span-full" : undefined}>
          <dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt>
          <dd className="break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cx(
          "w-full border-collapse text-sm [&_td]:border-b [&_td]:border-slate-200 [&_td]:px-2.5 [&_td]:py-2 [&_th]:border-b [&_th]:border-slate-200 [&_th]:px-2.5 [&_th]:py-2 [&_th]:text-start [&_th]:text-xs [&_th]:font-semibold [&_th]:whitespace-nowrap [&_th]:text-slate-500 dark:[&_td]:border-slate-800 dark:[&_th]:border-slate-800 dark:[&_th]:text-slate-400",
          className,
        )}
      >
        {children}
      </table>
    </div>
  );
}

export function Muted({ children, small }: { children: ReactNode; small?: boolean }) {
  return <span className={cx("text-slate-500 dark:text-slate-400", small && "text-xs")}>{children}</span>;
}

/** "3 min ago" from the translation files (Intl lacks some languages in Chrome). */
export function RelativeTime({ iso }: { iso: string | null }) {
  const { t, i18n } = useTranslation();
  if (!iso) return <Muted>—</Muted>;
  const date = new Date(iso);
  const s = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  const text =
    s < 10
      ? t("time.now")
      : s < 60
        ? t("time.seconds", { n: Math.floor(s / 10) * 10 })
        : s < 3600
          ? t("time.minutes", { n: Math.floor(s / 60) })
          : s < 86400
            ? t("time.hours", { n: Math.floor(s / 3600) })
            : t("time.days", { n: Math.floor(s / 86400) });
  return (
    <time dateTime={iso} title={date.toLocaleString(i18n.resolvedLanguage)}>
      {text}
    </time>
  );
}

export function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d ? `${d}d ` : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

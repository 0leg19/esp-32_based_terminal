// Server / TLS / Wi-Fi fields for POST /connect, shared by the single
// terminal form and the bulk form. Limits are those of provisioning.h.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { api, terminalMessage } from "../api.ts";
import { Button, Card, Field, Notice, Secret, Segmented } from "./ui.tsx";

export const MAX_CA = 3800;
const CONTROL = /[\x00-\x1f\x7f]/;

export type CaMode = "keep" | "set" | "bundle";

export interface Settings {
  url: string;
  apiKey: string;
  barrier: string;
  caMode: CaMode;
  caCert: string;
  wifiSsid: string;
  wifiPassword: string;
}

export const EMPTY_SETTINGS: Settings = { url: "", apiKey: "", barrier: "", caMode: "keep", caCert: "", wifiSsid: "", wifiPassword: "" };

/** Error keys under configure.errors. An empty barrier means "keep" when allowed. */
export function validateSettings(s: Settings, barrierRequired: boolean): string[] {
  const e: string[] = [];
  if (!s.url || !s.apiKey || (barrierRequired && !s.barrier)) e.push("required");
  if (s.url.length > 350) e.push("urlLong");
  if (s.url && !/^https?:\/\/[^\s/]+/.test(s.url)) e.push("urlScheme");
  if (/\s/.test(s.url)) e.push("urlSpace");
  if (s.apiKey.length > 64 || s.barrier.length > 64) e.push("secretLong");
  if ([s.url, s.apiKey, s.barrier].some((v) => CONTROL.test(v))) e.push("control");
  if (s.caMode === "set") {
    if (!s.caCert.trim().startsWith("-----BEGIN CERTIFICATE-----")) e.push("caPem");
    if (s.caCert.length > MAX_CA) e.push("caLong");
  }
  if (s.wifiSsid.length > 32) e.push("ssidLong");
  if (s.wifiPassword && !s.wifiSsid) e.push("passNoSsid");
  if (s.wifiPassword && (s.wifiPassword.length < 8 || s.wifiPassword.length > 63)) e.push("passLength");
  return e;
}

export function settingsBody(s: Settings): Record<string, string> {
  const b: Record<string, string> = { url: s.url.trim(), api_key: s.apiKey };
  if (s.barrier) b.barrier = s.barrier;
  if (s.caMode === "set") b.ca_cert = s.caCert.trim();
  if (s.caMode === "bundle") b.ca_cert = "";
  if (s.wifiSsid) {
    b.wifi_ssid = s.wifiSsid;
    b.wifi_password = s.wifiPassword;
  }
  return b;
}

export function Errors({ errors }: { errors: string[] }) {
  const { t } = useTranslation();
  if (!errors.length) return null;
  return (
    <Notice tone="error">
      <ul className="list-disc ps-4">
        {errors.map((e) => (
          <li key={e}>{t(`configure.errors.${e}`)}</li>
        ))}
      </ul>
    </Notice>
  );
}

export function ServerFields({
  value,
  onChange,
  serial,
  barrierHint,
}: {
  value: Settings;
  onChange: (s: Settings) => void;
  serial?: string;
  barrierHint?: string;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => onChange({ ...value, [k]: v });

  const fillFromTestServer = async () => {
    try {
      const m = await api.mock(serial);
      onChange({ ...value, url: m.urls.https ?? value.url, apiKey: m.config.apiKey, barrier: m.config.barrier, caMode: "set", caCert: m.caCert });
      setError(null);
    } catch (e) {
      setError(terminalMessage(e));
    }
  };

  return (
    <>
      <Card
        title={t("configure.server")}
        actions={
          <Button onClick={() => void fillFromTestServer()}>{t("configure.useTestServer")}</Button>
        }
      >
        {error && <Notice tone="error">{error}</Notice>}
        <Field label={t("configure.url")} hint={t("configure.urlHint")}>
          <input value={value.url} dir="ltr" placeholder="https://api.example.com/terminal" onChange={(e) => set("url")(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="api_key" hint={t("configure.apiKeyHint")}>
            <Secret value={value.apiKey} onChange={set("apiKey")} />
          </Field>
          <Field label="barrier" hint={barrierHint ?? t("configure.barrierHint")}>
            <Secret value={value.barrier} onChange={set("barrier")} />
          </Field>
        </div>
      </Card>

      <Card title={t("configure.tls")}>
        <Segmented value={value.caMode} onChange={set("caMode")} options={(["keep", "set", "bundle"] as CaMode[]).map((m) => ({ value: m, label: t(`configure.ca.${m}`) }))} />
        {value.caMode === "set" && (
          <Field label="ca_cert (PEM)" hint={t("configure.caHint", { n: value.caCert.length, max: MAX_CA })}>
            <textarea rows={6} dir="ltr" value={value.caCert} spellCheck={false} onChange={(e) => set("caCert")(e.target.value)} />
          </Field>
        )}
      </Card>
    </>
  );
}

export function WifiFields({ value, onChange }: { value: Settings; onChange: (s: Settings) => void }) {
  const { t } = useTranslation();
  return (
    <Card title={t("configure.wifi")}>
      <p className="text-sm text-slate-500 dark:text-slate-400">{t("configure.wifiHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="wifi_ssid">
          <input value={value.wifiSsid} dir="ltr" maxLength={32} onChange={(e) => onChange({ ...value, wifiSsid: e.target.value })} />
        </Field>
        <Field label="wifi_password">
          <Secret value={value.wifiPassword} onChange={(v) => onChange({ ...value, wifiPassword: v })} />
        </Field>
      </div>
    </Card>
  );
}

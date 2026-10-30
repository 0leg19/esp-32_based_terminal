import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, terminalMessage } from "../api.ts";
import type { Action, MockConfig, MockEvent, MockState, Rule, Simulation } from "../api.ts";
import { Badge, Button, Card, Code, CopyButton, Field, Notice, Table } from "../components/ui.tsx";
import type { Tone } from "../components/ui.tsx";
import { go } from "../nav.ts";

const ASCII = /^[\x20-\x7e]*$/;

function statusTone(e: MockEvent): Tone {
  if (e.status === null) return "error";
  if (e.status === 200) return "ok";
  if (e.status === 401 || e.status === 403) return "warn";
  return "error";
}

function useEvents(): MockEvent[] {
  const [events, setEvents] = useState<MockEvent[]>([]);
  useEffect(() => {
    const src = new EventSource("/api/mock/events");
    src.addEventListener("history", (m) => setEvents(JSON.parse((m as MessageEvent).data) as MockEvent[]));
    src.addEventListener("event", (m) => setEvents((list) => [...list.slice(-499), JSON.parse((m as MessageEvent).data) as MockEvent]));
    return () => src.close();
  }, []);
  return events;
}

export default function TestServer() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<MockState | null>(null);
  const [draft, setDraft] = useState<MockConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const events = useEvents();

  const load = useCallback(async () => {
    try {
      const s = await api.mock();
      setState(s);
      setDraft((d) => d ?? s.config);
    } catch (e) {
      setError(terminalMessage(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!state || !draft) return error ? <Notice tone="error">{error}</Notice> : <p className="text-slate-500 dark:text-slate-400">{t("common.loading")}</p>;

  const set = <K extends keyof MockConfig>(k: K, v: MockConfig[K]) => {
    setDraft({ ...draft, [k]: v });
    setSaved(false);
  };
  const setRule = (i: number, patch: Partial<Rule>) =>
    set(
      "rules",
      draft.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    );
  const addRule = (uid = "", action: Action = "allow") => set("rules", [...draft.rules, { uid, name: "", action }]);

  const save = async () => {
    try {
      const c = await api.saveMock(draft);
      setDraft(c);
      setSaved(true);
      setError(null);
      void load();
    } catch (e) {
      setError(terminalMessage(e));
    }
  };

  const nonAscii = [draft.allowMessage, draft.denyMessage, ...draft.rules.map((r) => r.message ?? "")].some((m) => !ASCII.test(m));
  const knownUids = new Set(draft.rules.map((r) => r.uid.toUpperCase()));
  const recentUnknown = [...new Set(events.map((e) => e.uid).filter((u): u is string => !!u && !knownUids.has(u)))].slice(-5);

  return (
    <div className="flex flex-col gap-4">
      <Card title={t("testServer.status")} actions={<Button variant="primary" onClick={() => go({ page: "terminals" })}>{t("testServer.provision")}</Button>}>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={state.listening.https ? "ok" : "error"}>HTTPS :{state.ports.https}</Badge>
          <Badge tone={state.listening.http ? "ok" : "error"}>HTTP :{state.ports.http}</Badge>
        </div>
        {state.errors.length > 0 && <Notice tone="error">{t("testServer.listenError", { errors: state.errors.join(", ") })}</Notice>}
        <dl className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-x-5 gap-y-3 [&_dd]:break-all [&_dt]:text-xs [&_dt]:text-slate-500">
          <div className="col-span-full">
            <dt>{t("testServer.urlHttps")}</dt>
            <dd dir="ltr">{state.urls.https ?? "—"} {state.urls.https && <CopyButton text={state.urls.https} />}</dd>
          </div>
          <div className="col-span-full">
            <dt>{t("testServer.urlHttp")}</dt>
            <dd dir="ltr">{state.urls.http ?? "—"}</dd>
          </div>
          <div className="col-span-full">
            <dt>{t("testServer.certNames")}</dt>
            <dd dir="ltr">{state.names.join(", ")}</dd>
          </div>
        </dl>
        <p className="text-slate-500 dark:text-slate-400">{t("testServer.provisionHint")}</p>
        <details>
          <summary>{t("testServer.caCert")}</summary>
          <Code>{state.caCert}</Code>
        </details>
      </Card>

      <Card title={t("testServer.settings")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("testServer.expectedApiKey")}>
            <input value={draft.apiKey} dir="ltr" onChange={(e) => set("apiKey", e.target.value)} />
          </Field>
          <Field label={t("testServer.expectedBarrier")}>
            <input value={draft.barrier} dir="ltr" onChange={(e) => set("barrier", e.target.value)} />
          </Field>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.checkAuth} onChange={(e) => set("checkAuth", e.target.checked)} />
          {t("testServer.checkAuth")}
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t("testServer.defaultAction")}>
            <select value={draft.defaultAction} onChange={(e) => set("defaultAction", e.target.value as "allow" | "deny")}>
              <option value="allow">{t("testServer.action.allow")}</option>
              <option value="deny">{t("testServer.action.deny")}</option>
            </select>
          </Field>
          <Field label={t("testServer.delay")} hint={t("testServer.delayHint")}>
            <input type="number" min={0} max={30000} step={100} value={draft.delayMs} onChange={(e) => set("delayMs", Number(e.target.value))} />
          </Field>
          <Field label={t("testServer.simulate")}>
            <select value={draft.simulate} onChange={(e) => set("simulate", e.target.value as Simulation)}>
              {(["none", "error500", "timeout", "close"] as Simulation[]).map((s) => (
                <option key={s} value={s}>
                  {t(`testServer.simulation.${s}`)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("testServer.allowMessage")}>
            <input value={draft.allowMessage} maxLength={76} onChange={(e) => set("allowMessage", e.target.value)} />
          </Field>
          <Field label={t("testServer.denyMessage")}>
            <input value={draft.denyMessage} maxLength={76} onChange={(e) => set("denyMessage", e.target.value)} />
          </Field>
        </div>
        {nonAscii && <Notice tone="warn">{t("testServer.asciiWarning")}</Notice>}
      </Card>

      <Card title={t("testServer.rules")} actions={<Button onClick={() => addRule()}>{t("testServer.addRule")}</Button>}>
        {draft.rules.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400">{t("testServer.noRules")}</p>
        ) : (
          <Table>
              <thead>
                <tr>
                  <th>UID</th>
                  <th>{t("testServer.ruleName")}</th>
                  <th>{t("testServer.ruleAction")}</th>
                  <th>{t("testServer.ruleStatus")}</th>
                  <th>{t("testServer.ruleMessage")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {draft.rules.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input value={r.uid} dir="ltr" className="font-mono" placeholder="04A1B2C3" onChange={(e) => setRule(i, { uid: e.target.value.toUpperCase() })} />
                    </td>
                    <td>
                      <input value={r.name} onChange={(e) => setRule(i, { name: e.target.value })} />
                    </td>
                    <td>
                      <select value={r.action} onChange={(e) => setRule(i, { action: e.target.value as Action })}>
                        {(["allow", "deny", "error"] as Action[]).map((a) => (
                          <option key={a} value={a}>
                            {t(`testServer.action.${a}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={100}
                        max={599}
                        className="!w-24"
                        placeholder={r.action === "allow" ? "200" : r.action === "deny" ? "403" : "500"}
                        value={r.status ?? ""}
                        onChange={(e) => setRule(i, { status: e.target.value ? Number(e.target.value) : undefined })}
                      />
                    </td>
                    <td>
                      <input value={r.message ?? ""} maxLength={76} onChange={(e) => setRule(i, { message: e.target.value || undefined })} />
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => set("rules", draft.rules.filter((_, j) => j !== i))}>
                        {t("common.remove")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
        )}
        {recentUnknown.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">{t("testServer.recentUnknown")}</span>
            {recentUnknown.map((u) => (
              <span key={u} className="inline-flex items-center gap-1 rounded-full border border-slate-300 py-0.5 ps-2.5 pe-1 dark:border-slate-700">
                <span dir="ltr" className="font-mono">
                  {u}
                </span>
                <Button size="sm" onClick={() => addRule(u, "allow")}>
                  {t("testServer.action.allow")}
                </Button>
                <Button size="sm" onClick={() => addRule(u, "deny")}>
                  {t("testServer.action.deny")}
                </Button>
              </span>
            ))}
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void save()}>
          {t("common.save")}
        </Button>
        {saved && <span className="text-slate-500 dark:text-slate-400">{t("common.saved")}</span>}
        {error && <Notice tone="error">{error}</Notice>}
      </div>

      <Card
        title={t("testServer.log", { n: events.length })}
        actions={
          <Button variant="ghost" onClick={() => void api.clearEvents()}>
            {t("common.clear")}
          </Button>
        }
      >
        {events.length === 0 ? (
          <p className="text-slate-500 dark:text-slate-400">{t("testServer.logEmpty")}</p>
        ) : (
          <Table className="[&_td]:whitespace-nowrap [&_td]:align-top">
              <thead>
                <tr>
                  <th>{t("testServer.time")}</th>
                  <th>UID</th>
                  <th>{t("testServer.result")}</th>
                  <th>{t("testServer.ruleMessage")}</th>
                  <th>{t("testServer.auth")}</th>
                  <th>{t("testServer.from")}</th>
                  <th>ms</th>
                </tr>
              </thead>
              <tbody>
                {[...events].reverse().map((e) => (
                  <tr key={e.id}>
                    <td dir="ltr">{new Date(e.time).toLocaleTimeString(i18n.resolvedLanguage)}</td>
                    <td dir="ltr" className="font-mono">
                      {e.uid ?? "—"}
                      {e.rule && <div className="text-xs text-slate-500 dark:text-slate-400">{e.rule}</div>}
                    </td>
                    <td>
                      <Badge tone={statusTone(e)}>{e.status ?? t("testServer.noResponse")}</Badge>
                    </td>
                    <td>
                      {e.message}
                      {e.error && <div className="text-xs text-slate-500 dark:text-slate-400">{e.error}</div>}
                    </td>
                    <td>
                      {e.apiKeyOk === null ? "—" : (
                        <>
                          <Badge tone={e.apiKeyOk ? "ok" : "error"}>key</Badge> <Badge tone={e.barrierOk ? "ok" : "error"}>barrier</Badge>
                        </>
                      )}
                    </td>
                    <td dir="ltr" className="text-xs">
                      {e.protocol}://{e.remote}
                    </td>
                    <td dir="ltr">{e.durationMs}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
        )}
      </Card>
    </div>
  );
}

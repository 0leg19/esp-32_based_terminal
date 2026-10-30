import { BookOpen, FlaskConical, Globe, KeyRound, LayoutGrid, Menu, Usb, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Dot, cx } from "./components/ui.tsx";
import { displayName, health, useFleet } from "./fleet.tsx";
import { LANGUAGES } from "./i18n.ts";
import { href, useRoute } from "./nav.ts";
import type { GlobalPage, Route } from "./nav.ts";
import Integration from "./pages/Integration.tsx";
import SerialLog from "./pages/SerialLog.tsx";
import Signing from "./pages/Signing.tsx";
import Terminal from "./pages/Terminal.tsx";
import Terminals from "./pages/Terminals.tsx";
import TestServer from "./pages/TestServer.tsx";

const SIDEBAR_TERMINALS = 8;

const GLOBAL: Record<GlobalPage, { icon: LucideIcon; component: () => React.JSX.Element }> = {
  terminals: { icon: LayoutGrid, component: Terminals },
  testServer: { icon: FlaskConical, component: TestServer },
  signing: { icon: KeyRound, component: Signing },
  serial: { icon: Usb, component: SerialLog },
  integration: { icon: BookOpen, component: Integration },
};

const SECTIONS: { title: string; pages: GlobalPage[] }[] = [
  { title: "sidebar.fleet", pages: ["terminals"] },
  { title: "sidebar.tools", pages: ["testServer", "signing", "serial"] },
  { title: "sidebar.docs", pages: ["integration"] },
];

function NavLink({ route, current, sub, children }: { route: Route; current: boolean; sub?: boolean; children: ReactNode }) {
  return (
    <a
      href={href(route)}
      aria-current={current ? "page" : undefined}
      className={cx(
        "flex min-w-0 items-center rounded-lg no-underline transition-colors",
        sub ? "gap-2 px-2 py-1 text-[13px]" : "gap-2.5 px-2.5 py-2 text-sm",
        current ? "bg-cyan-400/10 font-semibold text-cyan-300 shadow-[inset_3px_0_0] shadow-cyan-400 rtl:shadow-[inset_-3px_0_0]" : "text-slate-300 hover:bg-white/5 hover:text-white",
      )}
    >
      {children}
    </a>
  );
}

function Sidebar({ route, onNavigate }: { route: Route; onNavigate: () => void }) {
  const { t, i18n } = useTranslation();
  const { terminals } = useFleet();
  const activeSerial = route.page === "terminal" ? route.serial : null;

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto px-3.5 py-4" onClick={(e) => (e.target as HTMLElement).closest("a") && onNavigate()}>
      <div className="flex items-center gap-2.5 px-2">
        <img src="/favicon.svg" alt="" width="30" height="30" />
        <div className="leading-tight">
          <div className="font-bold text-white">NFC Terminal</div>
          <div className="text-xs text-slate-500">Manager</div>
        </div>
      </div>

      <nav aria-label={t("sidebar.navigation")} className="flex flex-1 flex-col gap-5">
        {SECTIONS.map((s) => (
          <div key={s.title}>
            <div className="px-2.5 pb-1.5 text-xs font-bold text-slate-500 caps:text-[11px] caps:uppercase caps:tracking-widest">{t(s.title)}</div>
            {s.pages.map((p) => {
              const Icon = GLOBAL[p].icon;
              return (
                <div key={p}>
                  <NavLink route={{ page: p }} current={route.page === p}>
                    <Icon size={18} aria-hidden className="flex-none" />
                    <span className="truncate">{t(`nav.${p}`)}</span>
                    {p === "terminals" && terminals.length > 0 && (
                      <span className="ms-auto rounded-full bg-white/10 px-2 text-xs font-semibold text-slate-300">{terminals.length}</span>
                    )}
                  </NavLink>
                  {p === "terminals" && terminals.length > 0 && (
                    <div className="ms-5 mt-1 flex flex-col border-s border-slate-800 ps-2">
                      {terminals.slice(0, SIDEBAR_TERMINALS).map((term) => (
                        <NavLink key={term.serial} sub route={{ page: "terminal", serial: term.serial, tab: "overview" }} current={activeSerial === term.serial}>
                          <Dot health={health(term)} />
                          <span className="truncate">{displayName(term)}</span>
                        </NavLink>
                      ))}
                      {terminals.length > SIDEBAR_TERMINALS && (
                        <a href={href({ page: "terminals" })} className="px-2 py-1 text-[13px] text-slate-500 no-underline hover:text-slate-300">
                          {t("sidebar.more", { n: terminals.length - SIDEBAR_TERMINALS })}
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-2.5 border-t border-slate-800 px-1 pt-3">
        <label className="flex items-center gap-2 text-slate-500">
          <Globe size={16} aria-hidden className="flex-none" />
          <span className="sr-only">{t("common.language")}</span>
          <select
            value={i18n.resolvedLanguage}
            onChange={(e) => void i18n.changeLanguage(e.target.value)}
            className="!border-slate-800 !bg-slate-900 !py-1.5 !text-slate-200"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <a href="https://github.com/0leg19/esp-32_based_terminal" target="_blank" rel="noreferrer" dir="ltr" className="px-1 text-xs text-slate-500 hover:text-slate-300">
          github.com/0leg19
        </a>
      </div>
    </div>
  );
}

export default function App() {
  const { t } = useTranslation();
  const route = useRoute();
  const { find } = useFleet();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    const term = route.page === "terminal" ? find(route.serial) : undefined;
    const title = route.page === "terminal" ? (term ? displayName(term) : route.serial) : t(`nav.${route.page}`);
    document.title = `${title} · NFC Terminal Manager`;
  }, [route, find, t]);

  const pageKey = route.page === "terminal" ? `t:${route.serial}` : route.page;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pageKey]);

  const Page = route.page === "terminal" ? null : GLOBAL[route.page].component;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex items-center gap-2.5 bg-slate-950 px-3.5 py-2 text-white lg:hidden">
        <button type="button" className="rounded-md p-1 text-white hover:bg-white/10" aria-label={t("sidebar.menu")} aria-expanded={drawer} onClick={() => setDrawer((d) => !d)}>
          {drawer ? <X size={22} /> : <Menu size={22} />}
        </button>
        <strong>NFC Terminal Manager</strong>
      </header>

      <aside
        className={cx(
          "fixed inset-y-0 start-0 z-30 w-sidebar border-e border-white/5 bg-slate-950 transition-transform duration-200",
          !drawer && "max-lg:-translate-x-full max-lg:rtl:translate-x-full",
        )}
      >
        <Sidebar route={route} onNavigate={() => setDrawer(false)} />
      </aside>
      {drawer && <div className="fixed inset-0 z-25 bg-black/50 lg:hidden" onClick={() => setDrawer(false)} />}

      <main className="min-w-0 px-4 pb-12 pt-5 lg:ms-sidebar lg:px-9 lg:pt-8">
        <div className="mx-auto max-w-7xl">
          {route.page === "terminal" ? (
            <Terminal key={route.serial} serial={route.serial} tab={route.tab} />
          ) : (
            <>
              <header className="mb-6">
                <h1 className="text-2xl font-bold tracking-tight">{t(`nav.${route.page}`)}</h1>
                <p className="mt-1 text-slate-500 dark:text-slate-400">{t(`${route.page}.lead`)}</p>
              </header>
              {Page && <Page />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

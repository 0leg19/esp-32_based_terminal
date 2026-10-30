import { useEffect, useState } from "react";

// #/terminals                    fleet table
// #/terminals/<serial>[/<tab>]   one terminal
// #/test-server, #/signing, #/serial, #/integration

export const GLOBAL_PAGES = ["terminals", "testServer", "signing", "serial", "integration"] as const;
export const TABS = ["overview", "configure", "diagnostics", "firmware"] as const;

export type GlobalPage = (typeof GLOBAL_PAGES)[number];
export type Tab = (typeof TABS)[number];
export type Route = { page: GlobalPage } | { page: "terminal"; serial: string; tab: Tab };

const SLUGS: Record<GlobalPage, string> = {
  terminals: "terminals",
  testServer: "test-server",
  signing: "signing",
  serial: "serial",
  integration: "integration",
};

export function parseHash(hash = window.location.hash): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "terminals" && parts[1]) {
    const tab = (TABS as readonly string[]).includes(parts[2] ?? "") ? (parts[2] as Tab) : "overview";
    return { page: "terminal", serial: parts[1], tab };
  }
  const page = GLOBAL_PAGES.find((p) => SLUGS[p] === parts[0]);
  return { page: page ?? "terminals" };
}

export function href(route: Route): string {
  if (route.page === "terminal") {
    const base = `#/terminals/${encodeURIComponent(route.serial)}`;
    return route.tab === "overview" ? base : `${base}/${route.tab}`;
  }
  return `#/${SLUGS[route.page]}`;
}

export function go(route: Route): void {
  window.location.hash = href(route).slice(1);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash());
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

// The managed terminals, polled from the backend (which polls the
// terminals themselves) every few seconds.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { api } from "./api.ts";
import type { FleetTerminal } from "./api.ts";
import type { Health } from "./components/ui.tsx";

const REFRESH_MS = 3000;

interface FleetState {
  terminals: FleetTerminal[];
  loaded: boolean;
  find: (serial: string) => FleetTerminal | undefined;
  refresh: () => Promise<void>;
  replace: (t: FleetTerminal) => void;
}

const Ctx = createContext<FleetState | null>(null);

export function FleetProvider({ children }: { children: ReactNode }) {
  const [terminals, setTerminals] = useState<FleetTerminal[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setTerminals(await api.fleet());
      setLoaded(true);
    } catch {
      /* backend restarting; keep the last list */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const value = useMemo<FleetState>(
    () => ({
      terminals,
      loaded,
      find: (serial) => terminals.find((t) => t.serial === serial),
      refresh,
      replace: (t) => setTerminals((list) => list.map((x) => (x.serial === t.serial ? t : x))),
    }),
    [terminals, loaded, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFleet(): FleetState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFleet outside FleetProvider");
  return v;
}

/** One word for the status dot: offline, attention (online but something is wrong), online. */
export function health(t: FleetTerminal): Health {
  if (t.online === null) return "unknown";
  if (!t.online) return "offline";
  if (t.info?.nfc_status !== "ready" || t.info?.connection_status !== "connected") return "attention";
  if (t.diag && (t.diag.server_reachable === false || t.diag.link_up === false)) return "attention";
  if (t.barrierOk === false) return "attention";
  return "online";
}

export function displayName(t: FleetTerminal): string {
  return t.name || t.serial.replace(/^ESP32_RFID_/, "");
}

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { probeSupabase } from "@/lib/onlineProbe";
import { isOfflineStorageAvailable } from "@/lib/offlineDb";

// Connectivity state for the whole app. `online` reflects a CONFIRMED reachable internet (active
// probe), not the browser's optimistic navigator.onLine. Components read `online`; the sync engine
// watches for offline -> online transitions.

type OnlineState = "online" | "offline" | "probing";

interface OnlineContextValue {
  online: boolean;
  state: OnlineState;
  lastOnlineAt: number | null;
  /** IndexedDB usable on this device (offline capture/cache available). */
  offlineStorage: boolean;
  /** Force a probe now; resolves to the confirmed reachability. */
  probeNow: () => Promise<boolean>;
}

const OnlineContext = createContext<OnlineContextValue | undefined>(undefined);

const ONLINE_INTERVAL_MS = 25_000;
const OFFLINE_INTERVAL_MS = 5_000;

export function OnlineProvider({ children }: { children: ReactNode }) {
  const initiallyOnline = typeof navigator === "undefined" ? true : navigator.onLine;
  const [state, setState] = useState<OnlineState>(initiallyOnline ? "probing" : "offline");
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<OnlineState>(state);
  stateRef.current = state;

  const probeNow = useCallback(async () => {
    const reachable = await probeSupabase();
    setState(reachable ? "online" : "offline");
    if (reachable) setLastOnlineAt(Date.now());
    return reachable;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      const delay = stateRef.current === "online" ? ONLINE_INTERVAL_MS : OFFLINE_INTERVAL_MS;
      timer.current = setTimeout(tick, delay);
    };
    const tick = async () => {
      if (cancelled) return;
      await probeNow();
      if (!cancelled) schedule();
    };

    const onOffline = () => setState("offline"); // trust the browser saying we're disconnected
    const onOnline = () => {
      setState("probing"); // the online event is optimistic — confirm before trusting it
      void probeNow();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void probeNow();
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    void tick(); // initial probe

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [probeNow]);

  // Re-schedule when state changes so we poll faster while offline.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const delay = state === "online" ? ONLINE_INTERVAL_MS : OFFLINE_INTERVAL_MS;
    timer.current = setTimeout(() => void probeNow(), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, probeNow]);

  return (
    <OnlineContext.Provider
      value={{ online: state === "online", state, lastOnlineAt, offlineStorage: isOfflineStorageAvailable(), probeNow }}
    >
      {children}
    </OnlineContext.Provider>
  );
}

export function useOnline(): OnlineContextValue {
  const ctx = useContext(OnlineContext);
  if (!ctx) throw new Error("useOnline must be used within <OnlineProvider>");
  return ctx;
}

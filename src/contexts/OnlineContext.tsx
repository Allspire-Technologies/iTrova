import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { probeSupabase } from "@/lib/onlineProbe";
import { isOfflineStorageAvailable } from "@/lib/offlineDb";

// Connectivity state for the whole app. `online` reflects a CONFIRMED reachable internet (active
// probe), not the browser's optimistic navigator.onLine. We start optimistic (online when the
// browser says so) and only flip offline on a failed probe or an `offline` event — so there's no
// "offline" flash on every load. The sync engine watches offline -> online transitions.

type OnlineState = "online" | "offline";

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
  const [state, setState] = useState<OnlineState>(initiallyOnline ? "online" : "offline");
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(initiallyOnline ? Date.now() : null);
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
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, stateRef.current === "online" ? ONLINE_INTERVAL_MS : OFFLINE_INTERVAL_MS);
    };
    const tick = async () => {
      if (cancelled) return;
      await probeNow();
      if (!cancelled) schedule();
    };

    const onOffline = () => setState("offline"); // browser says disconnected — trust it
    const onOnline = () => void probeNow(); // browser online is optimistic — confirm via probe
    const onVisible = () => {
      if (document.visibilityState === "visible") void probeNow();
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    void tick(); // confirm promptly; UI starts optimistic so there's no offline flash

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [probeNow]);

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

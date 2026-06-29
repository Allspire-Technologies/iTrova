import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useOnline } from "@/contexts/OnlineContext";
import { runPrewarm, PREWARM_TASKS } from "@/lib/offlinePrewarm";

// Drives the background offline pre-warm: runs once after sign-in and again on each offline->online
// reconnect, so every offline-capable module has fresh data without the user visiting it first.
// Never blocks navigation — it's just filling IndexedDB. The sign-out gate watches `status`.

type PrewarmStatus = "idle" | "running" | "done" | "error";

interface PrewarmValue {
  status: PrewarmStatus;
  done: number;
  total: number;
  label: string;
  /** Manually (re)start a pre-warm — used to retry after an error. */
  run: () => void;
}

const PrewarmContext = createContext<PrewarmValue | undefined>(undefined);

export function PrewarmProvider({ children }: { children: ReactNode }) {
  const { business } = useAuth();
  const { online, offlineStorage } = useOnline();
  const [status, setStatus] = useState<PrewarmStatus>("idle");
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(PREWARM_TASKS.length);
  const [label, setLabel] = useState("");
  const runningRef = useRef(false);
  const warmedFor = useRef<string | null>(null); // businessId already warmed this online session

  const run = useCallback(async () => {
    if (!business || !online || !offlineStorage || runningRef.current) return;
    runningRef.current = true;
    setStatus("running"); setDone(0); setLabel("");
    const res = await runPrewarm(business.id, (p) => { setDone(p.done); setTotal(p.total); setLabel(p.label); });
    runningRef.current = false;
    warmedFor.current = business.id;
    if (res.errors.length) {
      setStatus("error");
      toast.warning("Some offline data couldn't be prepared. It'll retry when you reconnect.");
    } else {
      setStatus("done");
      toast.success("Offline data ready.");
    }
  }, [business, online, offlineStorage]);

  // Run on login and on each offline -> online reconnect (the marker is cleared when offline).
  useEffect(() => {
    if (!business || !online || !offlineStorage) return;
    if (warmedFor.current === business.id) return;
    void run();
  }, [business, online, offlineStorage, run]);

  // Going offline clears the marker so the next reconnect re-warms with fresh data.
  useEffect(() => {
    if (!online) warmedFor.current = null;
  }, [online]);

  return (
    <PrewarmContext.Provider value={{ status, done, total, label, run }}>
      {children}
    </PrewarmContext.Provider>
  );
}

export function usePrewarm(): PrewarmValue {
  const ctx = useContext(PrewarmContext);
  if (!ctx) throw new Error("usePrewarm must be used within <PrewarmProvider>");
  return ctx;
}

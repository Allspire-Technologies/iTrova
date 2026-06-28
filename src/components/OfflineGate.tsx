import { ReactNode } from "react";
import { WifiOff } from "lucide-react";
import { useOnline } from "@/contexts/OnlineContext";

// Blocks a module while the device is offline. Point of Sale stays available; read-only views
// (Dashboard, Inventory) handle offline themselves and are not wrapped in this gate.
export function OfflineGate({ children }: { children: ReactNode }) {
  const { online } = useOnline();
  if (online) return <>{children}</>;
  return (
    <div className="max-w-md mx-auto mt-24 text-center space-y-3 p-8 rounded-2xl bg-card border border-border/60 shadow-card">
      <WifiOff className="size-10 mx-auto text-warning" />
      <h1 className="font-display text-xl font-bold text-brand-dark">You're offline</h1>
      <p className="text-sm text-muted-foreground">
        This feature needs an internet connection. Point of Sale still works, and any sales you make
        are saved on this device and sync automatically when you're back online.
      </p>
    </div>
  );
}

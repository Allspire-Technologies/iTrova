import { WifiOff } from "lucide-react";
import { useOnline } from "@/contexts/OnlineContext";

// Persistent bar shown app-wide while the device has no internet. Sales taken in POS are saved on
// the device and sync automatically when the connection returns.
export function OfflineBanner() {
  const { online } = useOnline();
  if (online) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-2 text-center text-sm font-medium text-warning">
      <WifiOff className="size-4 shrink-0" />
      <span>Offline — Point of Sale still works; sales are saved here and sync when you’re back online.</span>
    </div>
  );
}

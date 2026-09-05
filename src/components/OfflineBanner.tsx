import { WifiOff } from "lucide-react";
import { useOnline } from "@/contexts/OnlineContext";

// Persistent bar shown app-wide while the device has no internet. Sales taken in POS are saved on
// the device; the cashier taps Sync now when the connection returns (uploads are never automatic).
export function OfflineBanner() {
  const { online } = useOnline();
  if (online) return null;
  return (
    <div className="flex items-center justify-center gap-2 bg-warning/15 px-4 py-2 text-center text-sm font-medium text-warning">
      <WifiOff className="size-4 shrink-0" />
      <span>Offline — Point of Sale still works; sales are saved here. Tap Sync now when you’re back online.</span>
    </div>
  );
}

// Compact on-page notice for pages that render a read-only snapshot while offline (Dashboard,
// Inventory). The global bar says the app is offline; this explains what THIS page is showing.
export function ReadOnlyOfflineNotice() {
  const { online } = useOnline();
  if (online) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
      <WifiOff className="size-4 shrink-0" />
      <span>Offline — showing your last-synced data. Editing resumes when you’re back online.</span>
    </div>
  );
}

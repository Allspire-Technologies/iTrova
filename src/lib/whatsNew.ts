import type { LucideIcon } from "lucide-react";
import { Moon, Search } from "lucide-react";

// One-time "What's new" wizard content. Append a new entry (with a higher id) whenever a feature
// ships; users only see entries newer than the last one they dismissed, tracked in localStorage.

export type WhatsNewEntry = { id: number; title: string; body: string; icon: LucideIcon };

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    id: 1,
    icon: Moon,
    title: "Dark mode",
    body: "Tap the moon in the top bar to switch between light and dark. It follows your device by default and remembers your choice.",
  },
  {
    id: 2,
    icon: Search,
    title: "Search anything",
    body: "Press Ctrl/⌘ K — or the magnifier in the top bar — to jump to any page or find a product, supplier or invoice instantly.",
  },
];

const KEY = "itrova-whatsnew-seen";
export const LATEST_ID = WHATS_NEW.reduce((m, e) => Math.max(m, e.id), 0);

function lastSeenId(): number {
  try {
    return Number(localStorage.getItem(KEY)) || 0;
  } catch {
    return 0;
  }
}

/** Entries the user hasn't dismissed yet (newest features they haven't seen). */
export function unseenEntries(): WhatsNewEntry[] {
  const seen = lastSeenId();
  return WHATS_NEW.filter((e) => e.id > seen);
}

export function markAllSeen() {
  try {
    localStorage.setItem(KEY, String(LATEST_ID));
  } catch {
    /* private mode: it'll show again next session, harmless */
  }
}

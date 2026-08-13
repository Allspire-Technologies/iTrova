import type { LucideIcon } from "lucide-react";
import { Moon, Search, FileText, Trash2, BarChart3, Sparkles, FilePlus, CreditCard, Gift } from "lucide-react";

// One-time "What's new" wizard content. Append a new entry (with a higher id) whenever a feature
// ships; users only see entries newer than the last one they dismissed, tracked in localStorage.
// CONVENTION: every new feature gets an entry here, and when it lives on a specific page, set `route`
// (+ optional `cta`) so the wizard can take the user straight to that page to try it.

export type WhatsNewEntry = { id: number; title: string; body: string; icon: LucideIcon; route?: string; cta?: string };

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
  {
    id: 3,
    icon: FileText,
    title: "Invoice your inventory",
    body: "New invoices can bill inventory products — stock is deducted automatically — alongside custom items. Your dashboard and reports now track sales, cash collected and money owed.",
    route: "/invoices",
    cta: "Open Invoices",
  },
  {
    id: 4,
    icon: Trash2,
    title: "Delete or archive products",
    body: "You can now remove a product from Inventory. If it was never sold it's deleted outright; if it has history it's safely archived — hidden from your lists and till, but kept so your reports stay accurate, and restorable anytime.",
    route: "/inventory",
    cta: "Open Inventory",
  },
  {
    id: 5,
    icon: BarChart3,
    title: "Reports for every role",
    body: "Reports now match what each person is allowed to see. Cashiers get a personal sales report, production staff see runs and materials, and money metrics show only to those granted \"View financials\" — owners and managers by default.",
    route: "/reports",
    cta: "Open Reports",
  },
  {
    id: 6,
    icon: Sparkles,
    title: "A tidier, friendlier app",
    body: "iTrova now greets you by the time of day, scrollbars are slim and stay out of the way, the sidebar lines up neatly whether it's open or collapsed, and every hover hint is styled to match the app instead of your browser.",
    route: "/",
    cta: "Take a look",
  },
  {
    id: 7,
    icon: FilePlus,
    title: "Save an invoice as a draft",
    body: "Start an invoice and finish it later. A draft no longer holds stock — items come off your shelves when you issue it, not while you're still typing — and moving an issued invoice back to draft returns the stock.",
    route: "/invoices",
    cta: "Open Invoices",
  },
  {
    id: 8,
    icon: CreditCard,
    title: "Pay for your plan in the app",
    body: "Upgrade or renew without messaging us: pay by bank transfer or card and your plan activates itself. A transfer gets a one-off account number for the exact amount. You'll also find your billing history there, with a receipt to download for every payment.",
    route: "/settings?tab=billing",
    cta: "Open Billing",
  },
  {
    id: 9,
    icon: Gift,
    title: "Spend your referral credit",
    body: "The credit you earn from referring other businesses now pays for your own plan. When you renew or upgrade, it comes off the price and you pay the difference — or nothing at all if it covers the whole plan. Whatever's left stays on your balance.",
    route: "/settings?tab=billing",
    cta: "Open Billing",
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

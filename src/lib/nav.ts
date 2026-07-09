import {
  LayoutDashboard, Package, ShoppingCart, Truck, FileText, ClipboardList, Users,
  BarChart3, Sparkles, Settings, Boxes, Warehouse, Factory, Wallet, Ship,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Sidebar navigation model. Data + pure selectors live here (testable, no React); AppShell renders.
//
// Layout: a few pinned items on top, then collapsible sections, with Settings pinned at the bottom
// beside Sign out. A section hides entirely when the member can see none of its modules (plan × RBAC).

export type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; soon?: boolean; module?: string };
export type NavSection = { key: string; label: string; items: NavItem[] };

/** Always-on-top, ungrouped shortcuts to the most-used destinations. */
export const PINNED_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/pos", label: "Point of Sale", icon: ShoppingCart, module: "pos" },
  { to: "/inventory", label: "Inventory", icon: Package, module: "inventory" },
  { to: "/reports", label: "Reports", icon: BarChart3, module: "reports" },
];

export const NAV_SECTIONS: NavSection[] = [
  { key: "sales", label: "Sales", items: [
    { to: "/invoices", label: "Invoices", icon: FileText, module: "invoices" },
    { to: "/export-invoice", label: "Export Invoice", icon: Ship, module: "export_invoices" },
  ] },
  { key: "stock", label: "Stock", items: [
    { to: "/raw-materials", label: "Raw Materials", icon: Boxes, module: "raw_materials" },
    { to: "/production", label: "Production", icon: Factory, module: "production" },
    { to: "/general-store", label: "General Store", icon: Warehouse, module: "general_store" },
  ] },
  { key: "buy", label: "Buy", items: [
    { to: "/suppliers", label: "Suppliers", icon: Truck, module: "suppliers" },
    { to: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList, module: "purchase_orders" },
    { to: "/expenditure", label: "Expenditure", icon: Wallet, module: "expenditure" },
  ] },
  { key: "more", label: "More", items: [
    { to: "/insights", label: "AI Insights", icon: Sparkles, soon: true, module: "insights" },
    { to: "/team", label: "Team", icon: Users, module: "team" },
  ] },
];

/** Pinned at the bottom of the sidebar, next to Sign out (always visible — no module gate). */
export const SETTINGS_ITEM: NavItem = { to: "/settings", label: "Settings", icon: Settings };

export type NavGrants = { hasModule: (key: string) => boolean; can: (module: string, action: string) => boolean };

/** Visible = no module gate, or the plan grants the module AND the member can view it (owner: always). */
export function isNavItemVisible(item: NavItem, g: NavGrants): boolean {
  return !item.module || (g.hasModule(item.module) && g.can(item.module, "view"));
}

export function visiblePinned(g: NavGrants): NavItem[] {
  return PINNED_ITEMS.filter((i) => isNavItemVisible(i, g));
}

/** Sections with their visible items; a section with no visible items is dropped entirely. */
export function visibleSections(g: NavGrants): NavSection[] {
  return NAV_SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => isNavItemVisible(i, g)) }))
    .filter((s) => s.items.length > 0);
}

/** Flat list (pinned + every section's items) — the icon rail renders this when collapsed. */
export function allVisibleModuleItems(g: NavGrants): NavItem[] {
  return [...visiblePinned(g), ...visibleSections(g).flatMap((s) => s.items)];
}

/** The section key owning a path (for auto-opening the active section), or null for pinned/Settings. */
export function sectionKeyForPath(path: string): string | null {
  for (const s of NAV_SECTIONS) {
    if (s.items.some((i) => path === i.to || path.startsWith(i.to + "/"))) return s.key;
  }
  return null;
}

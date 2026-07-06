import { canAccessModule, planModules } from "./moduleAccess";
import type { PlanLimits } from "./planLimits";

// Onboarding plan picker: the owner ticks the modules they need and picks a rough scale band per
// countable resource; recommendPlan finds the cheapest catalogue plan covering both. Pure — the
// dialog renders whatever this returns.

export type ModuleChoice = { key: string; label: string; blurb: string };

/** The modules offered in the onboarding picker (curated order: everyday first, specialist last). */
export const MODULE_CHOICES: ModuleChoice[] = [
  { key: "pos", label: "Point of Sale", blurb: "Sell in person, print receipts, end-of-day totals" },
  { key: "inventory", label: "Inventory", blurb: "Track products, stock levels and expiry dates" },
  { key: "invoices", label: "Invoices", blurb: "Bill customers, record deposits, track what's owed" },
  { key: "suppliers", label: "Suppliers", blurb: "Keep supplier contacts and spend in one place" },
  { key: "raw_materials", label: "Raw Materials", blurb: "Track production inputs and purchases" },
  { key: "purchase_orders", label: "Purchase Orders", blurb: "Order from suppliers, receive into stock" },
  { key: "reports", label: "Reports", blurb: "Sales trends, top products, staff performance" },
  { key: "team", label: "Team", blurb: "Invite staff with roles and permissions" },
  { key: "export_invoices", label: "Export Invoices", blurb: "International invoices with PDF/DOCX output" },
  { key: "general_store", label: "General Store", blurb: "Internal store: staff checkouts and returns" },
];

export type ScaleResource = "products" | "staff" | "invoices";
export type ScaleBand = { key: string; label: string; /** Smallest cap that satisfies this band; null = needs unlimited. */ requires: number | null };

/** Scale bands per resource. `requires` is compared against the plan's cap for that resource. */
export const SCALE_QUESTIONS: { resource: ScaleResource; question: string; bands: ScaleBand[] }[] = [
  {
    resource: "products",
    question: "How many products will you stock?",
    bands: [
      { key: "s", label: "Up to 100", requires: 100 },
      { key: "m", label: "Up to 1,000", requires: 1000 },
      { key: "l", label: "More than 1,000", requires: null },
    ],
  },
  {
    resource: "staff",
    question: "How many people will use it?",
    bands: [
      { key: "s", label: "Just me, or up to 3", requires: 3 },
      { key: "m", label: "Up to 10", requires: 10 },
      { key: "l", label: "More than 10", requires: null },
    ],
  },
  {
    resource: "invoices",
    question: "How many invoices per month?",
    bands: [
      { key: "s", label: "Up to 300", requires: 300 },
      { key: "m", label: "Up to 2,000", requires: 2000 },
      { key: "l", label: "More than 2,000", requires: null },
    ],
  },
];

// Resource → the module key its cap is stored under in plans.limits (mirrors planLimits.ts).
const RESOURCE_LIMIT_KEY: Record<ScaleResource, { moduleKey: string; legacyKey: string }> = {
  products: { moduleKey: "inventory", legacyKey: "products" },
  staff: { moduleKey: "team", legacyKey: "staff" },
  invoices: { moduleKey: "invoices", legacyKey: "invoices" },
};

/** A plan's cap for a resource: number, null for unlimited, undefined when not configured. */
function planCap(limits: PlanLimits | null | undefined, resource: ScaleResource): number | null | undefined {
  if (!limits) return undefined;
  const { moduleKey, legacyKey } = RESOURCE_LIMIT_KEY[resource];
  if (moduleKey in limits) return limits[moduleKey] == null ? null : Number(limits[moduleKey]);
  if (legacyKey in limits) return limits[legacyKey] == null ? null : Number(limits[legacyKey]);
  return undefined;
}

export type RecommendablePlan = {
  key: string;
  name: string;
  modules: string[] | null;
  limits: PlanLimits | null;
  price_amount: number;
  sort_order: number;
  is_active?: boolean;
  business_id?: string | null;
  // Display extras carried through for the recommendation card (present on AuthContext's Plan).
  price_currency?: string;
  promo_percent?: number;
  promo_until?: string | null;
};

export type ScaleAnswers = Partial<Record<ScaleResource, string>>; // resource → band key

/** True when the plan's modules and caps cover the picked modules and scale bands. */
export function planCovers(plan: RecommendablePlan, picked: string[], answers: ScaleAnswers): boolean {
  const mods = planModules({ key: plan.key, modules: plan.modules });
  for (const m of picked) if (!canAccessModule(mods, m)) return false;
  for (const q of SCALE_QUESTIONS) {
    const bandKey = answers[q.resource];
    if (!bandKey) continue; // unanswered = no constraint
    const band = q.bands.find(b => b.key === bandKey);
    if (!band) continue;
    const cap = planCap(plan.limits, q.resource);
    // Unconfigured caps are treated as unlimited everywhere except Free, whose baseline caps are
    // hardcoded client-side (planLimits FREE_LIMITS) — mirror that so Free isn't over-recommended.
    const effectiveCap = cap !== undefined ? cap
      : plan.key === "free" ? { products: 100, staff: 3, invoices: 300 }[q.resource]
      : null;
    if (band.requires === null) { if (effectiveCap !== null) return false; }
    else if (effectiveCap !== null && effectiveCap < band.requires) return false;
  }
  return true;
}

export type Recommendation =
  | { kind: "free" }                          // Free covers everything they picked
  | { kind: "plan"; plan: RecommendablePlan } // cheapest qualifying paid plan
  | { kind: "custom" };                       // nothing in the catalogue covers it

/**
 * Cheapest catalogue plan covering the selection. Catalogue = active, non-business-specific plans.
 * Free wins outright when it qualifies; otherwise qualifying paid plans are ordered by price then
 * sort_order. An empty catalogue or no qualifying plan → "custom" (contact sales).
 */
export function recommendPlan(picked: string[], answers: ScaleAnswers, plans: RecommendablePlan[]): Recommendation {
  const catalogue = plans.filter(p => (p.is_active ?? true) && !p.business_id);
  const free = catalogue.find(p => p.key === "free");
  if (free && planCovers(free, picked, answers)) return { kind: "free" };
  const qualifying = catalogue
    .filter(p => p.key !== "free" && planCovers(p, picked, answers))
    .sort((a, b) => (a.price_amount - b.price_amount) || (a.sort_order - b.sort_order));
  return qualifying.length ? { kind: "plan", plan: qualifying[0] } : { kind: "custom" };
}

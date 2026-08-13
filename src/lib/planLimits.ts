export type PlanResource = "products" | "suppliers" | "rawMaterials" | "purchaseOrders" | "invoices" | "staff";
export type PlanLimits = Record<string, number | null>;

// Each countable resource belongs to a module, so a plan's limits can be keyed by the
// module name (e.g. {"inventory": 100, "team": 5}) and still resolve. The legacy
// resource keys ({"products": 100}) keep working as a fallback.
const RESOURCE_MODULE: Record<PlanResource, string> = {
  products:       "inventory",
  suppliers:      "suppliers",
  rawMaterials:   "raw_materials",
  purchaseOrders: "purchase_orders",
  invoices:       "invoices",
  staff:          "team",
};

const RESOURCE_LABELS: Record<PlanResource, string> = {
  products:       "products",
  suppliers:      "suppliers",
  rawMaterials:   "raw materials",
  purchaseOrders: "purchase orders",
  invoices:       "invoices",
  staff:          "team members",
};

// Limits by plan key, populated from the Supabase `plans` table at runtime. This is the ONLY
// source of a cap — there is no hardcoded copy here. plans.limits is edited from the CRM, so any
// number written into this file starts drifting the moment someone changes a plan (it did: this
// file said 25/50, the migration seed said 100/300, and production said 25/50/3 — three answers to
// one question). Before the plans load, nothing is capped client-side; the database triggers are
// the enforcement, and the UI is a courtesy on top of them.
const registry: Record<string, PlanLimits> = {};

export function registerPlanLimits(plans: { key: string; limits?: PlanLimits | null }[]): void {
  for (const p of plans) registry[p.key] = p.limits ?? {};
}

/** The numeric cap for a resource on the given tier, or null when the plan doesn't cap it (and
 *  before the plans have loaded). Read straight from what the backend published — a plan that
 *  omits a key is unlimited for that resource, exactly as the database reads it. */
export function getLimit(tier: string | null | undefined, resource: PlanResource): number | null {
  const planLimits = tier ? registry[tier] : undefined;
  if (!planLimits) return null;
  const moduleKey = RESOURCE_MODULE[resource];
  const v = moduleKey in planLimits ? planLimits[moduleKey]
    : resource in planLimits ? planLimits[resource]
    : undefined;
  if (v === undefined || v === null) return null;
  return Number(v);
}

/** True when count has reached or exceeded the plan cap. */
export function isAtLimit(count: number, tier: string | null | undefined, resource: PlanResource): boolean {
  const limit = getLimit(tier, resource);
  return limit !== null && count >= limit;
}

/** Human-readable message to show when a limit is hit — the number and the plan named are the
 *  CALLER'S, not Free's. Quoting the Free cap to a paying customer ("Free plan limit reached
 *  (3 team members)" on Pro, whose cap is 10) is both wrong and insulting. */
export function limitMessage(resource: PlanResource, tier?: string | null): string {
  const t = tier || "free";
  const limit = getLimit(t, resource);
  const label = RESOURCE_LABELS[resource];
  const planName = t.charAt(0).toUpperCase() + t.slice(1);
  const upgrade = t === "free" ? "Upgrade to Pro to add more." : "Upgrade your plan to add more.";
  return `${planName} plan limit reached (${limit} ${label}). ${upgrade}`;
}

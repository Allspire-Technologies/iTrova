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

const FREE_LIMITS: Record<PlanResource, number> = {
  products:       100,
  suppliers:       10,
  rawMaterials:    50,
  purchaseOrders:  50,
  invoices:      300,
  staff:            3,
};

const RESOURCE_LABELS: Record<PlanResource, string> = {
  products:       "products",
  suppliers:      "suppliers",
  rawMaterials:   "raw materials",
  purchaseOrders: "purchase orders",
  invoices:       "invoices",
  staff:          "team members",
};

// Limits by plan key, populated from the Supabase `plans` table at runtime. Until it's
// loaded (or for an unknown tier) we fall back to the Free caps so enforcement is safe.
const registry: Record<string, PlanLimits> = {};

export function registerPlanLimits(plans: { key: string; limits?: PlanLimits | null }[]): void {
  for (const p of plans) registry[p.key] = p.limits ?? {};
}

/** Returns the numeric cap for a resource on the given tier, or null if unlimited. */
export function getLimit(tier: string | null | undefined, resource: PlanResource): number | null {
  const planLimits = tier ? registry[tier] : undefined;
  if (planLimits) {
    const moduleKey = RESOURCE_MODULE[resource];
    const v = moduleKey in planLimits ? planLimits[moduleKey]
      : resource in planLimits ? planLimits[resource]
      : undefined;
    if (v !== undefined) return v == null ? null : Number(v);
  }
  if (!tier || tier === "free") return FREE_LIMITS[resource];
  return null;
}

/** True when count has reached or exceeded the plan cap. */
export function isAtLimit(count: number, tier: string | null | undefined, resource: PlanResource): boolean {
  const limit = getLimit(tier, resource);
  return limit !== null && count >= limit;
}

/** Human-readable message to show when a limit is hit. */
export function limitMessage(resource: PlanResource): string {
  const limit = FREE_LIMITS[resource];
  const label = RESOURCE_LABELS[resource];
  return `Free plan limit reached (${limit} ${label}). Upgrade to Pro to add more.`;
}

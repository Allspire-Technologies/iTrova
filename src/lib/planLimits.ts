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

// The Free tier's caps come from the DB (plans.limits) and load into `registry` at startup. These are
// only the fallback used before that loads (and for an unknown tier), so keep them matching the DB
// Free plan — and only for the resources Free is actually limited on. Free's other modules (suppliers,
// raw materials, purchase orders) aren't included in the plan, so they carry no cap here (modules and
// limits stay aligned).
const FREE_LIMITS: Partial<Record<PlanResource, number>> = {
  products:  25,
  invoices:  50,
  staff:      3,
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
  if (!tier || tier === "free") return FREE_LIMITS[resource] ?? null;
  return null;
}

/** True when count has reached or exceeded the plan cap. */
export function isAtLimit(count: number, tier: string | null | undefined, resource: PlanResource): boolean {
  const limit = getLimit(tier, resource);
  return limit !== null && count >= limit;
}

/** Human-readable message to show when a limit is hit — the number comes from the DB-driven cap. */
export function limitMessage(resource: PlanResource): string {
  const limit = getLimit("free", resource);
  const label = RESOURCE_LABELS[resource];
  return `Free plan limit reached (${limit} ${label}). Upgrade to Pro to add more.`;
}

export type PlanResource = "products" | "suppliers" | "rawMaterials" | "purchaseOrders" | "invoices" | "staff";

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

/** Returns the numeric cap for a resource on the given tier, or null if unlimited. */
export function getLimit(tier: string | null | undefined, resource: PlanResource): number | null {
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

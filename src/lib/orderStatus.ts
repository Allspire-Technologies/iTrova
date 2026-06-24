export const ORDER_STATUSES = ["pending", "shipped", "delivered", "cancelled"] as const;

/**
 * Which statuses an order can move to from its current one.
 * - delivered locks to delivered / cancelled only
 * - cancelled is final (like a voided invoice)
 */
export function orderStatusOptions(status: string): string[] {
  if (status === "cancelled") return ["cancelled"];
  if (status === "delivered") return ["delivered", "cancelled"];
  return [...ORDER_STATUSES];
}

/** Cancelled is terminal — its dropdown is read-only. */
export function isOrderLocked(status: string): boolean {
  return status === "cancelled";
}

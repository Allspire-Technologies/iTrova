export type BillingCycle = "monthly" | "quarterly" | "biannual" | "annual";

export const CYCLE_ORDER: BillingCycle[] = ["monthly", "quarterly", "biannual", "annual"];

export const CYCLE_LABEL: Record<BillingCycle, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  biannual: "Bi-annual",
  annual: "Annually",
};

export const CYCLE_PERIOD: Record<BillingCycle, string> = {
  monthly: "month",
  quarterly: "quarter",
  biannual: "6 months",
  annual: "year",
};

/** A plan-level promo is active when it has a positive percent and hasn't expired. */
export function isPromoActive(
  promoPercent: number,
  promoUntil: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!promoPercent || Number(promoPercent) <= 0) return false;
  if (!promoUntil) return true;
  return Date.parse(promoUntil) > now;
}

/** Reduce an amount by a percentage, rounded to the nearest whole unit. */
export function applyDiscount(amount: number, percent: number): number {
  const base = Number(amount) || 0;
  const pct = Number(percent) || 0;
  if (pct <= 0) return base;
  return Math.round(base * (1 - pct / 100));
}

/** Price after applying an active promo; unchanged otherwise. */
export function effectivePrice(
  priceAmount: number,
  promoPercent: number,
  promoUntil: string | null | undefined,
  now: number = Date.now(),
): number {
  const base = Number(priceAmount) || 0;
  if (!isPromoActive(promoPercent, promoUntil, now)) return base;
  return applyDiscount(base, promoPercent);
}

/**
 * Eventual price for a billing cycle: the gross list price reduced by the cycle's
 * discount, then by any active plan-level promo layered on top.
 */
export function cyclePrice(
  listAmount: number,
  discountPercent: number,
  promoPercent: number,
  promoUntil: string | null | undefined,
  now: number = Date.now(),
): number {
  return effectivePrice(applyDiscount(listAmount, discountPercent), promoPercent, promoUntil, now);
}

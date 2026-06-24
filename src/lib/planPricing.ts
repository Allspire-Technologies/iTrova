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

/** Price after applying an active promo; unchanged otherwise. */
export function effectivePrice(
  priceAmount: number,
  promoPercent: number,
  promoUntil: string | null | undefined,
  now: number = Date.now(),
): number {
  const base = Number(priceAmount) || 0;
  if (!isPromoActive(promoPercent, promoUntil, now)) return base;
  return Math.round(base * (1 - Number(promoPercent) / 100));
}

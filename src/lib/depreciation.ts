// Straight-line depreciation for the Assets module. An asset loses `rate` of its ORIGINAL cost each
// year (default 20%/yr → written off after 1/rate = 5 years). Mirrors run_depreciation in SQL.

function round2(n: number): number {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

export const DEFAULT_RATE = 0.2;

/** Whole years since purchase (never negative). */
export function yearsElapsed(yearPurchased: number | null | undefined, currentYear = new Date().getFullYear()): number {
  const y = Number(yearPurchased);
  if (!y) return 0;
  return Math.max(0, currentYear - y);
}

/** One year's charge = cost × rate. */
export function annualDepreciation(cost: number, rate: number): number {
  return round2((Number(cost) || 0) * (Number(rate) || 0));
}

/** Total depreciation to date, capped at cost (an asset can't depreciate below zero). */
export function accumulatedDepreciation(cost: number, rate: number, years: number): number {
  const c = Number(cost) || 0;
  return round2(Math.min(c, c * (Number(rate) || 0) * (Number(years) || 0)));
}

/** Net book value now = cost − accumulated depreciation (floored at 0). */
export function currentValue(
  cost: number, rate: number, yearPurchased: number | null | undefined, currentYear = new Date().getFullYear(),
): number {
  const c = Number(cost) || 0;
  return round2(Math.max(0, c - accumulatedDepreciation(c, rate, yearsElapsed(yearPurchased, currentYear))));
}

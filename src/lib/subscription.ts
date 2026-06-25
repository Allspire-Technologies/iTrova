import type { BillingCycle } from "./planPricing";

const DAY_MS = 86_400_000;

const CYCLE_MONTHS: Record<BillingCycle, number> = { monthly: 1, quarterly: 3, biannual: 6, annual: 12 };

/**
 * Renewal date = start + the cycle's length, as an ISO string. Null if either input is
 * missing/invalid. Mirrors the DB trigger that derives subscription_renews_at; the stored
 * value remains authoritative, this is the app-side fallback and for any in-app grant flow.
 */
export function nextRenewal(startedAt: string | null | undefined, cycle: string | null | undefined): string | null {
  if (!startedAt || !cycle || !(cycle in CYCLE_MONTHS)) return null;
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return null;
  const d = new Date(start);
  d.setMonth(d.getMonth() + CYCLE_MONTHS[cycle as BillingCycle]);
  return d.toISOString();
}

/** A paid subscription is expired once its renewal date has passed. No date = never expires. */
export function isExpired(renewsAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!renewsAt) return false;
  const t = Date.parse(renewsAt);
  return !Number.isNaN(t) && t <= now;
}

/** Whole days until renewal (rounded up); negative once past, or null when there's no date. */
export function daysRemaining(renewsAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!renewsAt) return null;
  const t = Date.parse(renewsAt);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / DAY_MS);
}

/** The tier to actually grant: an expired paid tier falls back to Free. */
export function effectiveTier(
  tier: string | null | undefined,
  renewsAt: string | null | undefined,
  now: number = Date.now(),
): string {
  return isExpired(renewsAt, now) ? "free" : (tier || "free");
}

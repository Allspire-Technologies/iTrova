const DAY_MS = 86_400_000;

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

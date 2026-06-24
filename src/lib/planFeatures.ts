/** Highest-tier shared catalogue plan (ignores per-business custom plans). */
export function highestCataloguePlan<T extends { sort_order: number; business_id: string | null }>(
  plans: T[],
): T | null {
  let top: T | null = null;
  for (const p of plans) {
    if (p.business_id !== null) continue;
    if (!top || p.sort_order > top.sort_order) top = p;
  }
  return top;
}

/** The next-lower catalogue plan below `plan` (highest sort_order still under it), or null. */
export function previousCataloguePlan<T extends { sort_order: number; business_id: string | null }>(
  plans: T[],
  plan: T,
): T | null {
  let prev: T | null = null;
  for (const p of plans) {
    if (p.business_id !== null) continue;
    if (p.sort_order >= plan.sort_order) continue;
    if (!prev || p.sort_order > prev.sort_order) prev = p;
  }
  return prev;
}

/** True when every feature in `base` is also present in `features` (a strict superset). */
export function includesAll(features: string[], base: string[]): boolean {
  const have = new Set(features);
  return base.every(f => have.has(f));
}

/** Features present in `features` but not already in `base`, order preserved and de-duplicated. */
export function featuresBeyond(features: string[], base: string[]): string[] {
  const have = new Set(base);
  const out: string[] = [];
  for (const f of features) {
    if (have.has(f) || out.includes(f)) continue;
    out.push(f);
  }
  return out;
}

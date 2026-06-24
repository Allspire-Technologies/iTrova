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

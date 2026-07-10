// Landed cost: the true "to-my-warehouse" cost of a purchase = goods + freight + duty + other
// (clearing, insurance, handling…). Entered as itemized lines; totalled; then allocated across a
// PO's line items BY VALUE (pro-rata to each line's goods value) to get a per-unit landed cost.
//
// These pure helpers mirror the SQL in the receive/purchase triggers so the on-screen preview equals
// what the server stores. Amounts are in the business currency and exclude recoverable input VAT
// (that stays a separate field — VAT is reclaimed, so it doesn't capitalise into inventory value).

export type LandedBasis = "value" | "weight";
export type LandedCostLine = { label: string; amount: number; basis?: LandedBasis };

/** Sum of the itemized landed-cost amounts. */
export function landedTotal(lines: LandedCostLine[]): number {
  return lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

/** Round to 2dp, dropping the remainder onto the largest raw share so parts sum exactly. */
function distribute(shares: number[], amount: number): number[] {
  const raw = shares.map(s => s * amount);
  const out = raw.map(r => Math.round(r * 100) / 100);
  const drift = Math.round((amount - out.reduce((s, r) => s + r, 0)) * 100) / 100;
  if (drift !== 0 && raw.length) {
    let hi = 0;
    for (let i = 1; i < raw.length; i++) if (raw[i] > raw[hi]) hi = i;
    out[hi] = Math.round((out[hi] + drift) * 100) / 100;
  }
  return out;
}

/**
 * Allocate each landed-cost line across items by its own basis: "weight" lines split by item weight
 * (falling back to value, then equal, when weights are missing), "value"/default lines by item value.
 * Returns the total allocated landed cost per item (same order).
 */
export function allocateLanded(items: { value: number; weight: number }[], lines: LandedCostLine[]): number[] {
  const n = items.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0) return out;
  const totalValue = items.reduce((s, i) => s + (Number(i.value) || 0), 0);
  const totalWeight = items.reduce((s, i) => s + (Number(i.weight) || 0), 0);
  for (const line of lines) {
    const amount = Number(line.amount) || 0;
    if (amount <= 0) continue;
    const byWeight = line.basis === "weight" && totalWeight > 0;
    const shares = items.map((it) =>
      byWeight ? (Number(it.weight) || 0) / totalWeight
      : totalValue > 0 ? (Number(it.value) || 0) / totalValue
      : 1 / n,
    );
    const parts = distribute(shares, amount);
    for (let i = 0; i < n; i++) out[i] = Math.round((out[i] + parts[i]) * 100) / 100;
  }
  return out;
}

/** Moving-average cost = (old value + received value) / (old qty + received qty). */
export function movingAverageCost(oldQty: number, oldCost: number, recvQty: number, recvValue: number): number {
  const total = (Number(oldQty) || 0) + (Number(recvQty) || 0);
  if (total <= 0) return Number(oldCost) || 0;
  return ((Number(oldQty) || 0) * (Number(oldCost) || 0) + (Number(recvValue) || 0)) / total;
}

/**
 * Allocate `totalLanded` across lines pro-rata to each line's goods value. Returns the allocated
 * amount per line (same order), rounded to 2dp with the remainder placed on the highest-value line
 * so the parts sum exactly to the total. With no value basis, splits equally.
 */
export function allocateByValue(lineValues: number[], totalLanded: number): number[] {
  const n = lineValues.length;
  if (n === 0 || totalLanded <= 0) return lineValues.map(() => 0);
  const totalValue = lineValues.reduce((s, v) => s + (Number(v) || 0), 0);
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const raw = totalValue > 0
    ? lineValues.map(v => (Number(v) || 0) / totalValue * totalLanded)
    : lineValues.map(() => totalLanded / n);
  const out = raw.map(round2);
  const drift = round2(totalLanded - out.reduce((s, r) => s + r, 0));
  if (drift !== 0) {
    let hi = 0;
    for (let i = 1; i < raw.length; i++) if (raw[i] > raw[hi]) hi = i;
    out[hi] = round2(out[hi] + drift);
  }
  return out;
}

/** True per-unit cost = goods unit cost + this line's allocated landed cost ÷ quantity. */
export function landedUnitCost(unitCost: number, allocatedLanded: number, qty: number): number {
  const q = Number(qty) || 0;
  if (q <= 0) return Number(unitCost) || 0;
  return (Number(unitCost) || 0) + (Number(allocatedLanded) || 0) / q;
}

/**
 * Convenience for a PO: given the line items (unit cost + qty) and the landed-cost lines, return the
 * allocated landed cost and the landed unit cost for each item (same order).
 */
export function landedUnitCostsForPo(
  items: { unitCost: number; qty: number; weight?: number }[],
  landedLines: LandedCostLine[],
): { allocated: number; landedUnit: number }[] {
  const allocated = allocateLanded(
    items.map(i => ({ value: (Number(i.unitCost) || 0) * (Number(i.qty) || 0), weight: (Number(i.weight) || 0) * (Number(i.qty) || 0) })),
    landedLines,
  );
  return items.map((i, idx) => ({ allocated: allocated[idx], landedUnit: landedUnitCost(i.unitCost, allocated[idx], i.qty) }));
}

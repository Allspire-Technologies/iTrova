// Landed cost: the true "to-my-warehouse" cost of a purchase = goods + freight + duty + other
// (clearing, insurance, handling…). Entered as itemized lines; totalled; then allocated across a
// PO's line items BY VALUE (pro-rata to each line's goods value) to get a per-unit landed cost.
//
// These pure helpers mirror the SQL in the receive/purchase triggers so the on-screen preview equals
// what the server stores. Amounts are in the business currency and exclude recoverable input VAT
// (that stays a separate field — VAT is reclaimed, so it doesn't capitalise into inventory value).

export type LandedCostLine = { label: string; amount: number };

/** Sum of the itemized landed-cost amounts. */
export function landedTotal(lines: LandedCostLine[]): number {
  return lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
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
  items: { unitCost: number; qty: number }[],
  landedLines: LandedCostLine[],
): { allocated: number; landedUnit: number }[] {
  const values = items.map(i => (Number(i.unitCost) || 0) * (Number(i.qty) || 0));
  const allocated = allocateByValue(values, landedTotal(landedLines));
  return items.map((i, idx) => ({ allocated: allocated[idx], landedUnit: landedUnitCost(i.unitCost, allocated[idx], i.qty) }));
}

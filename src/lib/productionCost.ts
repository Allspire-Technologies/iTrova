// Pure production-costing maths (mirrored by record_production_run in SQL). A run's cost = the raw
// materials it consumes (used + wasted, at their cost) + optional labour/overhead. That cost is
// allocated across the products produced in proportion to their selling value, giving a cost per unit
// that becomes each product's cost price (blended via the business's valuation method server-side).

function round2(n: number): number {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

export interface CostMaterial { quantity_used: number; quantity_wasted?: number | null; cost_per_unit?: number | null }
export interface CostOutput { quantity: number; selling_price?: number | null; cost_price_override?: number | null }

/** Total cost of a run: Σ (used + wasted) × cost_per_unit, plus labour/overhead. */
export function runCost(materials: CostMaterial[], labourOverhead = 0): number {
  const mat = (materials ?? []).reduce((a, m) =>
    a + ((Number(m.quantity_used) || 0) + (Number(m.quantity_wasted) || 0)) * (Number(m.cost_per_unit) || 0), 0);
  return round2(mat + (Number(labourOverhead) || 0));
}

/**
 * Allocate a total cost across outputs by relative selling value (qty × selling_price). Falls back to
 * splitting by quantity when no output has a price, or evenly when there's no quantity either.
 */
export function allocateByValue(outputs: { quantity: number; selling_price?: number | null }[], totalCost: number): number[] {
  const total = round2(totalCost);
  const values = (outputs ?? []).map((o) => (Number(o.quantity) || 0) * (Number(o.selling_price) || 0));
  const totalValue = values.reduce((a, v) => a + v, 0);
  const qtys = (outputs ?? []).map((o) => Number(o.quantity) || 0);
  const totalQty = qtys.reduce((a, v) => a + v, 0);
  const shares = totalValue > 0 ? values.map((v) => v / totalValue)
    : totalQty > 0 ? qtys.map((q) => q / totalQty)
    : (outputs ?? []).map(() => 1 / Math.max(1, (outputs ?? []).length));
  // Distribute to 2dp, putting the rounding remainder on the largest share so the parts sum to total.
  const raw = shares.map((s) => s * total);
  const rounded = raw.map(round2);
  const drift = round2(total - rounded.reduce((a, v) => a + v, 0));
  if (drift !== 0 && rounded.length) {
    let bi = 0; for (let i = 1; i < raw.length; i++) if (raw[i] > raw[bi]) bi = i;
    rounded[bi] = round2(rounded[bi] + drift);
  }
  return rounded;
}

/** Per-output cost PER UNIT: a manual override wins, else the allocated cost ÷ quantity. */
export function outputUnitCosts(outputs: CostOutput[], materials: CostMaterial[], labourOverhead = 0): number[] {
  const allocated = allocateByValue(outputs ?? [], runCost(materials, labourOverhead));
  return (outputs ?? []).map((o, i) => {
    if (o.cost_price_override != null && o.cost_price_override !== undefined && String(o.cost_price_override) !== "")
      return round2(o.cost_price_override);
    const qty = Number(o.quantity) || 0;
    return qty > 0 ? round2(allocated[i] / qty) : 0;
  });
}

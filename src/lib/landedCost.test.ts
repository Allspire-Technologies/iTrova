import { describe, it, expect } from "vitest";
import { landedTotal, allocateByValue, allocateLanded, movingAverageCost, landedUnitCost, landedUnitCostsForPo } from "./landedCost";

describe("landedTotal", () => {
  it("sums itemized landed-cost amounts (tolerates bad values)", () => {
    expect(landedTotal([{ label: "Freight", amount: 40000 }, { label: "Duty", amount: 30000 }, { label: "Clearing", amount: 4000 }])).toBe(74000);
    expect(landedTotal([])).toBe(0);
    expect(landedTotal([{ label: "x", amount: NaN as unknown as number }])).toBe(0);
  });
});

describe("allocateByValue", () => {
  it("splits pro-rata to each line's value", () => {
    // Values 60,000 and 40,000 (60/40); 10,000 landed → 6,000 / 4,000.
    expect(allocateByValue([60000, 40000], 10000)).toEqual([6000, 4000]);
  });

  it("parts always sum exactly to the total (remainder on the largest line)", () => {
    const out = allocateByValue([100, 100, 100], 10); // 3.33 each → 3.34/3.33/3.33
    expect(out.reduce((s, v) => s + v, 0)).toBeCloseTo(10, 2);
    expect(Math.max(...out)).toBeCloseTo(3.34, 2);
  });

  it("splits equally when there is no value basis, and returns zeros when nothing is landed", () => {
    expect(allocateByValue([0, 0], 100)).toEqual([50, 50]);
    expect(allocateByValue([10, 20], 0)).toEqual([0, 0]);
    expect(allocateByValue([], 100)).toEqual([]);
  });
});

describe("allocateLanded (per-line basis)", () => {
  // Two items: A value 60,000 weight 10; B value 40,000 weight 40 (B is heavier).
  const items = [{ value: 60000, weight: 10 }, { value: 40000, weight: 40 }];

  it("splits a value-basis line by value and a weight-basis line by weight", () => {
    // Freight 10,000 by weight (10/40 split) → 2,000 / 8,000. Duty 10,000 by value (60/40) → 6,000 / 4,000.
    const out = allocateLanded(items, [
      { label: "Freight", amount: 10000, basis: "weight" },
      { label: "Duty", amount: 10000, basis: "value" },
    ]);
    expect(out).toEqual([8000, 12000]); // A: 2,000+6,000 ; B: 8,000+4,000
  });

  it("falls back to value when a weight-basis line has no weights", () => {
    const noWeight = [{ value: 60000, weight: 0 }, { value: 40000, weight: 0 }];
    expect(allocateLanded(noWeight, [{ label: "Freight", amount: 10000, basis: "weight" }])).toEqual([6000, 4000]);
  });

  it("defaults a line with no basis to value", () => {
    expect(allocateLanded(items, [{ label: "Other", amount: 10000 }])).toEqual([6000, 4000]);
  });
});

describe("movingAverageCost", () => {
  it("blends old stock cost with the received value", () => {
    // 20 @ ₦6,000 on hand, receive 100 valued at ₦674,000 → (120,000 + 674,000)/120 = ₦6,616.67.
    expect(movingAverageCost(20, 6000, 100, 674000)).toBeCloseTo(6616.67, 2);
  });
  it("returns the old cost when nothing is on hand or received", () => {
    expect(movingAverageCost(0, 6000, 0, 0)).toBe(6000);
  });
});

describe("landedUnitCost", () => {
  it("adds the allocated landed cost per unit", () => {
    // 100 rice @ ₦6,000; allocated landed ₦74,000 → +740/unit → ₦6,740.
    expect(landedUnitCost(6000, 74000, 100)).toBe(6740);
  });
  it("returns the plain unit cost when qty is 0", () => {
    expect(landedUnitCost(6000, 74000, 0)).toBe(6000);
  });
});

describe("landedUnitCostsForPo", () => {
  it("allocates by value and yields each line's landed unit cost", () => {
    // Line A: 10 @ 6,000 = 60,000; Line B: 20 @ 2,000 = 40,000. Landed 10,000 → 6,000/4,000.
    const res = landedUnitCostsForPo(
      [{ unitCost: 6000, qty: 10 }, { unitCost: 2000, qty: 20 }],
      [{ label: "Freight", amount: 10000 }],
    );
    expect(res[0]).toEqual({ allocated: 6000, landedUnit: 6600 }); // 6000 + 6000/10
    expect(res[1]).toEqual({ allocated: 4000, landedUnit: 2200 }); // 2000 + 4000/20
  });
});

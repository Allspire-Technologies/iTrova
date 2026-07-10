import { describe, it, expect } from "vitest";
import { landedTotal, allocateByValue, landedUnitCost, landedUnitCostsForPo } from "./landedCost";

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

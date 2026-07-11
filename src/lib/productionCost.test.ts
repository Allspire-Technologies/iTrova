import { describe, it, expect } from "vitest";
import { runCost, allocateByValue, outputUnitCosts } from "./productionCost";

describe("runCost", () => {
  it("sums used + wasted at cost, plus labour/overhead", () => {
    const materials = [
      { quantity_used: 10, quantity_wasted: 2, cost_per_unit: 500 }, // 12 × 500 = 6000
      { quantity_used: 5, quantity_wasted: 0, cost_per_unit: 200 },  // 5 × 200 = 1000
    ];
    expect(runCost(materials, 1500)).toBe(8500);
  });
  it("is materials-only when no overhead", () => {
    expect(runCost([{ quantity_used: 4, cost_per_unit: 250 }])).toBe(1000);
  });
  it("treats missing costs as zero", () => {
    expect(runCost([{ quantity_used: 4, cost_per_unit: null }], 0)).toBe(0);
  });
});

describe("allocateByValue", () => {
  it("splits by relative selling value", () => {
    // Output A: 10 × 800 = 8000 value; B: 10 × 200 = 2000 value → 80/20 of 10,000
    expect(allocateByValue([{ quantity: 10, selling_price: 800 }, { quantity: 10, selling_price: 200 }], 10000))
      .toEqual([8000, 2000]);
  });
  it("falls back to quantity when there are no prices", () => {
    expect(allocateByValue([{ quantity: 3, selling_price: 0 }, { quantity: 1, selling_price: 0 }], 8000))
      .toEqual([6000, 2000]);
  });
  it("keeps the parts summing to the total (remainder on the largest)", () => {
    const parts = allocateByValue([{ quantity: 1, selling_price: 1 }, { quantity: 1, selling_price: 1 }, { quantity: 1, selling_price: 1 }], 100);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("outputUnitCosts", () => {
  const materials = [{ quantity_used: 12, quantity_wasted: 0, cost_per_unit: 500 }]; // run cost 6000
  it("gives cost per unit from the allocated cost", () => {
    // single output of 20 units → 6000/20 = 300
    expect(outputUnitCosts([{ quantity: 20, selling_price: 1000 }], materials)).toEqual([300]);
  });
  it("allocates by value across multiple outputs then divides by qty", () => {
    // run cost 6000; A 10×900=9000 val, B 10×300=3000 val → 4500 / 1500 → per unit 450 / 150
    expect(outputUnitCosts([{ quantity: 10, selling_price: 900 }, { quantity: 10, selling_price: 300 }], materials))
      .toEqual([450, 150]);
  });
  it("honours a manual override", () => {
    expect(outputUnitCosts([{ quantity: 20, selling_price: 1000, cost_price_override: 250 }], materials)).toEqual([250]);
  });
  it("adds labour/overhead into the per-unit cost", () => {
    // run cost 6000 + 2000 overhead = 8000; single output 20 → 400
    expect(outputUnitCosts([{ quantity: 20, selling_price: 1000 }], materials, 2000)).toEqual([400]);
  });
});

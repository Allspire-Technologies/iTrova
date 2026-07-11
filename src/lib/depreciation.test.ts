import { describe, it, expect } from "vitest";
import { yearsElapsed, annualDepreciation, accumulatedDepreciation, currentValue } from "./depreciation";

describe("yearsElapsed", () => {
  it("counts whole years since purchase", () => {
    expect(yearsElapsed(2023, 2026)).toBe(3);
  });
  it("is zero in the purchase year and never negative", () => {
    expect(yearsElapsed(2026, 2026)).toBe(0);
    expect(yearsElapsed(2030, 2026)).toBe(0);
  });
});

describe("annualDepreciation", () => {
  it("is cost × rate", () => {
    expect(annualDepreciation(500000, 0.2)).toBe(100000);
  });
});

describe("accumulatedDepreciation", () => {
  it("accumulates each year", () => {
    expect(accumulatedDepreciation(500000, 0.2, 3)).toBe(300000);
  });
  it("never exceeds the original cost", () => {
    expect(accumulatedDepreciation(500000, 0.2, 8)).toBe(500000); // capped at 5 years' worth
  });
});

describe("currentValue", () => {
  it("worked example: 500,000 at 20%/yr, bought 2023, now 2026 → 200,000", () => {
    expect(currentValue(500000, 0.2, 2023, 2026)).toBe(200000);
  });
  it("equals cost in the purchase year", () => {
    expect(currentValue(500000, 0.2, 2026, 2026)).toBe(500000);
  });
  it("is fully written off after 1/rate years and stays at zero", () => {
    expect(currentValue(500000, 0.2, 2020, 2026)).toBe(0); // 6 years > 5
    expect(currentValue(500000, 0.2, 2010, 2026)).toBe(0);
  });
  it("handles a different rate (laptop at 33%)", () => {
    expect(currentValue(300000, 0.33, 2025, 2026)).toBe(201000); // 300k − 99k
  });
});

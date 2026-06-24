import { describe, it, expect } from "vitest";
import { isPromoActive, effectivePrice, applyDiscount, cyclePrice, CYCLE_ORDER, CYCLE_LABEL } from "./planPricing";

const FUTURE = "2999-01-01T00:00:00Z";
const PAST = "2000-01-01T00:00:00Z";

describe("isPromoActive", () => {
  it("is false with no/zero percent", () => {
    expect(isPromoActive(0, FUTURE)).toBe(false);
    expect(isPromoActive(0, null)).toBe(false);
  });
  it("is true with a positive percent and no expiry or a future expiry", () => {
    expect(isPromoActive(20, null)).toBe(true);
    expect(isPromoActive(20, FUTURE)).toBe(true);
  });
  it("is false once expired", () => {
    expect(isPromoActive(20, PAST)).toBe(false);
  });
});

describe("effectivePrice", () => {
  it("returns the base price when no promo applies", () => {
    expect(effectivePrice(5000, 0, null)).toBe(5000);
    expect(effectivePrice(5000, 20, PAST)).toBe(5000);
  });
  it("applies an active promo, rounding to the nearest whole unit", () => {
    expect(effectivePrice(5000, 20, FUTURE)).toBe(4000);
    expect(effectivePrice(13500, 10, null)).toBe(12150);
  });
  it("treats a free price as free", () => {
    expect(effectivePrice(0, 50, null)).toBe(0);
  });
});

describe("applyDiscount", () => {
  it("reduces the amount by the percentage, rounded", () => {
    expect(applyDiscount(15000, 10)).toBe(13500);
    expect(applyDiscount(30000, 15)).toBe(25500);
    expect(applyDiscount(60000, 20)).toBe(48000);
  });
  it("returns the amount unchanged for a zero/negative discount", () => {
    expect(applyDiscount(5000, 0)).toBe(5000);
    expect(applyDiscount(5000, -5)).toBe(5000);
  });
  it("keeps a free price free", () => {
    expect(applyDiscount(0, 50)).toBe(0);
  });
});

describe("cyclePrice", () => {
  it("applies the cycle discount to the gross list price", () => {
    expect(cyclePrice(15000, 10, 0, null)).toBe(13500);
    expect(cyclePrice(60000, 20, 0, null)).toBe(48000);
  });
  it("layers an active promo on top of the cycle discount", () => {
    expect(cyclePrice(15000, 10, 20, FUTURE)).toBe(10800);
  });
  it("ignores an expired promo", () => {
    expect(cyclePrice(15000, 10, 20, PAST)).toBe(13500);
  });
  it("keeps a free price free", () => {
    expect(cyclePrice(0, 20, 50, FUTURE)).toBe(0);
  });
});

describe("cycle metadata", () => {
  it("orders cycles shortest to longest with human labels", () => {
    expect(CYCLE_ORDER).toEqual(["monthly", "quarterly", "biannual", "annual"]);
    expect(CYCLE_LABEL.biannual).toBe("Bi-annual");
    expect(CYCLE_LABEL.annual).toBe("Annually");
  });
});

import { describe, it, expect } from "vitest";
import { isPromoActive, effectivePrice, CYCLE_ORDER, CYCLE_LABEL } from "./planPricing";

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

describe("cycle metadata", () => {
  it("orders cycles shortest to longest with human labels", () => {
    expect(CYCLE_ORDER).toEqual(["monthly", "quarterly", "biannual", "annual"]);
    expect(CYCLE_LABEL.biannual).toBe("Bi-annual");
    expect(CYCLE_LABEL.annual).toBe("Annually");
  });
});

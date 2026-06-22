import { describe, it, expect } from "vitest";
import { getLimit, isAtLimit, limitMessage } from "./planLimits";

describe("getLimit", () => {
  it("returns the free cap for free/unset tiers", () => {
    expect(getLimit("free", "products")).toBe(100);
    expect(getLimit(null, "products")).toBe(100);
    expect(getLimit(undefined, "staff")).toBe(3);
  });
  it("returns null (unlimited) for paid tiers", () => {
    expect(getLimit("pro", "products")).toBeNull();
    expect(getLimit("business", "invoices")).toBeNull();
  });
});

describe("isAtLimit", () => {
  it("is true at or over the cap on free", () => {
    expect(isAtLimit(100, "free", "products")).toBe(true);
    expect(isAtLimit(101, "free", "products")).toBe(true);
  });
  it("is false below the cap", () => {
    expect(isAtLimit(99, "free", "products")).toBe(false);
  });
  it("is always false on paid tiers", () => {
    expect(isAtLimit(99_999, "pro", "products")).toBe(false);
  });
});

describe("limitMessage", () => {
  it("mentions the cap and the resource label", () => {
    const msg = limitMessage("products");
    expect(msg).toContain("100");
    expect(msg).toContain("products");
  });
});

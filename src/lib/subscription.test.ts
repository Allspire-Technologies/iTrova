import { describe, it, expect } from "vitest";
import { isExpired, daysRemaining, effectiveTier } from "./subscription";

const NOW = Date.parse("2026-06-24T12:00:00Z");
const future = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

describe("isExpired", () => {
  it("is false when there is no renewal date", () => {
    expect(isExpired(null, NOW)).toBe(false);
    expect(isExpired(undefined, NOW)).toBe(false);
  });
  it("is true once the renewal date has passed", () => {
    expect(isExpired(future(-1), NOW)).toBe(true);
    expect(isExpired(future(5), NOW)).toBe(false);
  });
  it("ignores an unparseable date", () => {
    expect(isExpired("not-a-date", NOW)).toBe(false);
  });
});

describe("daysRemaining", () => {
  it("returns null when there is no renewal date", () => {
    expect(daysRemaining(null, NOW)).toBeNull();
  });
  it("counts whole days until renewal, rounded up", () => {
    expect(daysRemaining(future(5), NOW)).toBe(5);
    expect(daysRemaining(new Date(NOW + 1.2 * 86_400_000).toISOString(), NOW)).toBe(2);
  });
  it("is negative once past", () => {
    expect(daysRemaining(future(-3), NOW)).toBe(-3);
  });
});

describe("effectiveTier", () => {
  it("keeps the paid tier while active", () => {
    expect(effectiveTier("pro", future(5), NOW)).toBe("pro");
    expect(effectiveTier("business", null, NOW)).toBe("business");
  });
  it("falls back to free once expired", () => {
    expect(effectiveTier("pro", future(-1), NOW)).toBe("free");
  });
  it("defaults to free when no tier is set", () => {
    expect(effectiveTier(null, null, NOW)).toBe("free");
  });
});

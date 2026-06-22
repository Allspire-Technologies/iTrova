import { describe, it, expect } from "vitest";
import { formatMoney, getCurrencySymbol, formatDate } from "./format";

describe("formatMoney", () => {
  it("formats NGN with the naira symbol and thousands separators", () => {
    expect(formatMoney(1234, "NGN")).toBe("₦1,234");
    expect(formatMoney(1_000_000, "NGN")).toBe("₦1,000,000");
  });
  it("keeps up to two decimals", () => {
    expect(formatMoney(1234.5, "NGN")).toBe("₦1,234.5");
  });
  it("treats null/undefined as zero", () => {
    expect(formatMoney(0)).toBe("₦0");
    expect(formatMoney(null)).toBe("₦0");
    expect(formatMoney(undefined)).toBe("₦0");
  });
  it("uses the right symbol for other currencies", () => {
    expect(formatMoney(50, "USD")).toBe("$50");
    expect(formatMoney(50, "GHS")).toBe("₵50");
  });
});

describe("getCurrencySymbol", () => {
  it("returns the symbol for known currencies", () => {
    expect(getCurrencySymbol("NGN")).toBe("₦");
    expect(getCurrencySymbol("GHS")).toBe("₵");
  });
  it("falls back to the code for unknown currencies", () => {
    expect(getCurrencySymbol("XAF")).toBe("XAF");
  });
});

describe("formatDate", () => {
  it("returns empty string for empty/invalid input", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate(null)).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
  it("renders the date in the given timezone (Lagos crosses midnight before UTC)", () => {
    const instant = "2026-06-21T23:30:00Z";
    expect(formatDate(instant, "Africa/Lagos", { day: "2-digit" })).toBe("22");
    expect(formatDate(instant, "UTC", { day: "2-digit" })).toBe("21");
  });
});

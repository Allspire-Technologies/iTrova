import { describe, it, expect } from "vitest";
import { yymmdd, invoiceFallbackNumber } from "./invoiceNumber";

describe("yymmdd", () => {
  it("formats year, month and day as two digits each", () => {
    expect(yymmdd(new Date(2026, 5, 25))).toBe("260625"); // 25 Jun 2026
    expect(yymmdd(new Date(2026, 0, 5))).toBe("260105");  // 5 Jan 2026 (padded)
    expect(yymmdd(new Date(2030, 11, 31))).toBe("301231");
  });
  it("takes the last two digits of the year", () => {
    expect(yymmdd(new Date(2009, 0, 1))).toBe("090101");
  });
});

describe("invoiceFallbackNumber", () => {
  it("is the date prefix plus a numeric suffix", () => {
    const d = new Date(2026, 5, 25);
    expect(invoiceFallbackNumber(d)).toMatch(/^260625-\d+$/);
    expect(invoiceFallbackNumber(d).startsWith(yymmdd(d) + "-")).toBe(true);
  });
  it("varies between calls so it can't collide", () => {
    const d = new Date(2026, 5, 25);
    const a = new Set(Array.from({ length: 50 }, () => invoiceFallbackNumber(d)));
    expect(a.size).toBeGreaterThan(1);
  });
});

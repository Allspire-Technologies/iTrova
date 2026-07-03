import { describe, it, expect } from "vitest";
import { lineTotal, invoiceTotal, formatExportMoney, emptyItem } from "./exportInvoice";

describe("lineTotal", () => {
  it("multiplies boxes by unit price", () => {
    expect(lineTotal({ boxes: 6, unit_price: 128000 })).toBe(768000);
  });
  it("treats missing/negative/NaN as zero", () => {
    expect(lineTotal({ boxes: 0, unit_price: 100 })).toBe(0);
    expect(lineTotal({ boxes: -3, unit_price: 100 })).toBe(0);
    expect(lineTotal({ boxes: 5, unit_price: Number.NaN })).toBe(0);
  });
});

describe("invoiceTotal", () => {
  it("sums each line's boxes x unit price (never a stale stored total)", () => {
    const items = [
      { ...emptyItem(), boxes: 6, unit_price: 128000, total: 999 }, // stale total ignored
      { ...emptyItem(), boxes: 16, unit_price: 153600 },
    ];
    expect(invoiceTotal(items)).toBe(768000 + 2457600);
  });
  it("is zero for no lines", () => {
    expect(invoiceTotal([])).toBe(0);
  });
});

describe("formatExportMoney", () => {
  it("prefixes the currency code and groups with two decimals", () => {
    expect(formatExportMoney(768000, "NGN")).toBe("NGN 768,000.00");
    expect(formatExportMoney(1234.5, "USD")).toBe("USD 1,234.50");
  });
  it("handles non-numbers as zero", () => {
    expect(formatExportMoney(Number.NaN, "EUR")).toBe("EUR 0.00");
  });
});

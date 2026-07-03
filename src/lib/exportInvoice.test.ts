import { describe, it, expect, vi } from "vitest";

// The module imports the Supabase client (no env in CI) — stub it; these tests only touch pure helpers.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { lineTotal, invoiceTotal, totalCartons, depletionQty, formatExportMoney, numberToWords, amountInWords, emptyItem } from "./exportInvoice";

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

describe("totalCartons + depletionQty", () => {
  it("sums boxes for the summary and deducts boxes x units/box from stock", () => {
    const items = [
      { ...emptyItem(), boxes: 10, units_per_box: 48 },
      { ...emptyItem(), boxes: 5, units_per_box: 12 },
    ];
    expect(totalCartons(items)).toBe(15);
    expect(depletionQty(items[0])).toBe(480);
    expect(depletionQty(items[1])).toBe(60);
  });
});

describe("numberToWords + amountInWords", () => {
  it("spells integers", () => {
    expect(numberToWords(0)).toBe("Zero");
    expect(numberToWords(768000)).toBe("Seven Hundred and Sixty-Eight Thousand");
    expect(numberToWords(31927000)).toBe("Thirty-One Million, Nine Hundred and Twenty-Seven Thousand");
  });
  it("appends the currency word and Only", () => {
    expect(amountInWords(31927000, "NGN")).toBe("Thirty-One Million, Nine Hundred and Twenty-Seven Thousand Naira Only");
    expect(amountInWords(2500, "USD")).toBe("Two Thousand, Five Hundred US Dollars Only");
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

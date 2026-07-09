import { describe, it, expect } from "vitest";
import { findSkuConflict, buildImportPlan, expiryAlert, canonicalizeRow, normalizeHeader, parseImportNumber } from "./inventoryRules";

describe("expiryAlert", () => {
  const today = "2026-06-30";
  it("returns null with no date or when more than 90 days away", () => {
    expect(expiryAlert(null, today)).toBeNull();
    expect(expiryAlert(undefined, today)).toBeNull();
    expect(expiryAlert("2026-12-31", today)).toBeNull(); // ~184 days
    expect(expiryAlert("2026-09-29", today)).toBeNull();  // 91 days
  });
  it("badges from 90 days (notice band)", () => {
    const a = expiryAlert("2026-09-28", today); // 90 days
    expect(a?.band).toBe("notice");
    expect(a?.daysLeft).toBe(90);
  });
  it("escalates at 30, 15 and 3 days", () => {
    expect(expiryAlert("2026-07-30", today)?.band).toBe("soon");      // 30
    expect(expiryAlert("2026-07-15", today)?.band).toBe("warning");   // 15
    expect(expiryAlert("2026-07-03", today)?.band).toBe("critical");  // 3
  });
  it("flags today and past dates as expired/critical", () => {
    expect(expiryAlert("2026-06-30", today)).toMatchObject({ band: "critical", label: "Expires today" });
    expect(expiryAlert("2026-06-20", today)).toMatchObject({ band: "expired", label: "Expired" });
  });
});

describe("findSkuConflict", () => {
  const products = [
    { id: "1", sku: "GAR-50", name: "Garri" },
    { id: "2", sku: "RICE-25", name: "Rice" },
  ];
  it("matches case-insensitively and trims", () => {
    expect(findSkuConflict("gar-50", products)?.id).toBe("1");
    expect(findSkuConflict("  GAR-50 ", products)?.id).toBe("1");
  });
  it("returns null when no product uses the SKU", () => {
    expect(findSkuConflict("NEW-1", products)).toBeNull();
  });
  it("excludes the product being edited", () => {
    expect(findSkuConflict("GAR-50", products, "1")).toBeNull();
  });
  it("returns null for an empty SKU", () => {
    expect(findSkuConflict("  ", products)).toBeNull();
  });
});

describe("buildImportPlan", () => {
  // A complete, valid row (every required column filled); pass overrides for the field under test.
  const full = (over: Record<string, string> = {}) =>
    ({ name: "P", sku: "S1", unit: "pcs", selling_price: "10", cost_price: "5", stock_quantity: "1", reorder_level: "5", ...over });

  it("inserts new SKUs", () => {
    const plan = buildImportPlan([full({ sku: "S1", stock_quantity: "5" })], [], 0, null);
    expect(plan.updates).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].sku).toBe("S1");
    expect(plan.inserts[0].stock_quantity).toBe(5);
    expect(plan.rejected).toHaveLength(0);
  });

  it("restocks an existing SKU (case-insensitive) by adding quantity", () => {
    const plan = buildImportPlan([full({ sku: "s1", stock_quantity: "5" })], [{ id: "e1", sku: "S1", stock_quantity: 3 }], 1, null);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ id: "e1", fields: expect.objectContaining({ sku: "s1" }), stock: 8 }]);
  });

  it("flags duplicate SKUs within the same file as failed (case-insensitive), importing neither", () => {
    const plan = buildImportPlan(
      [full({ sku: "S1", name: "A" }), full({ sku: "s1", name: "B" }), full({ sku: "S2", name: "C" })],
      [], 0, null,
    );
    expect(plan.inserts).toHaveLength(1); // only the unique S2
    expect(plan.inserts[0].name).toBe("C");
    expect(plan.rejected).toHaveLength(2);
    expect(plan.rejected.every(r => /duplicate sku/i.test(r.reason))).toBe(true);
  });

  it("still restocks an existing SKU that appears once in the file", () => {
    const plan = buildImportPlan(
      [full({ sku: "S1", stock_quantity: "5" })],
      [{ id: "e1", sku: "S1", stock_quantity: 3 }], 1, null,
    );
    expect(plan.updates).toEqual([{ id: "e1", fields: expect.objectContaining({ sku: "S1" }), stock: 8 }]);
    expect(plan.rejected).toHaveLength(0);
  });

  it("applies the plan limit to new products only, never to restocks", () => {
    const plan = buildImportPlan(
      [full({ sku: "S1", stock_quantity: "5" }), full({ sku: "S2", stock_quantity: "1" }), full({ sku: "S3", stock_quantity: "1" })],
      [{ id: "e1", sku: "S1", stock_quantity: 1 }],
      1,
      1,
    );
    expect(plan.updates).toHaveLength(1); // S1 restock allowed
    expect(plan.inserts).toHaveLength(0); // no capacity for new
    expect(plan.rejected).toHaveLength(2);
    expect(plan.rejected.every(r => /plan limit/i.test(r.reason))).toBe(true);
  });
});

describe("buildImportPlan required-column validation", () => {
  const full = (over: Record<string, string> = {}) =>
    ({ name: "P", sku: "S1", unit: "pcs", selling_price: "10", cost_price: "5", stock_quantity: "1", reorder_level: "5", ...over });

  it("rejects a row missing any required column, naming each one, and keeps the good rows", () => {
    const plan = buildImportPlan(
      [{ name: "no sku", unit: "pcs", selling_price: "1", cost_price: "1", stock_quantity: "1", reorder_level: "1" }, full({ sku: "S2" })],
      [], 0, null,
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].reason).toContain("Missing SKU");
    expect(plan.rejected[0].row).toMatchObject({ name: "no sku" }); // original row kept for re-download
  });

  it("category, unit and expiry date are optional (unit defaults to pcs)", () => {
    const plan = buildImportPlan(
      [{ name: "P", sku: "S1", selling_price: "10", cost_price: "5", stock_quantity: "1", reorder_level: "5" }],
      [], 0, null,
    );
    expect(plan.rejected).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].unit).toBe("pcs");
  });

  it("rejects a non-numeric price as invalid rather than importing 0", () => {
    const plan = buildImportPlan([full({ selling_price: "abc" })], [], 0, null);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.rejected[0].reason).toContain("Invalid Selling Price");
  });
});

describe("buildImportPlan header + number robustness", () => {
  it("maps human/case-varied headers onto the right fields (prices are not zeroed)", () => {
    const plan = buildImportPlan(
      [{ "Name": "Garri", "SKU": "G1", "Unit": "bag", "Cost Price": "6000", "Selling Price": "8500", "Stock Quantity": "20", "Reorder Level": "5" }],
      [], 0, null,
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({
      name: "Garri", sku: "G1", unit: "bag", cost_price: 6000, selling_price: 8500, reorder_level: 5, stock_quantity: 20,
    });
  });

  it("accepts common aliases (Product / Code / Buy Price / Qty)", () => {
    const plan = buildImportPlan(
      [{ "Product": "Rice", "Code": "R1", "Unit": "bag", "Price": "1200", "Buy Price": "800", "Qty": "3", "Reorder": "2" }],
      [], 0, null,
    );
    expect(plan.inserts[0]).toMatchObject({ name: "Rice", sku: "R1", selling_price: 1200, cost_price: 800, stock_quantity: 3, reorder_level: 2 });
  });

  it("strips currency symbols and thousands separators from numbers", () => {
    const plan = buildImportPlan(
      [{ "name": "A", "sku": "A1", "unit": "pcs", "cost_price": "₦1,500", "selling_price": " 2,000.50 ", "stock_quantity": "1,000", "reorder_level": "5" }],
      [], 0, null,
    );
    expect(plan.inserts[0]).toMatchObject({ cost_price: 1500, selling_price: 2000.5 });
    expect(plan.inserts[0].stock_quantity).toBe(1000);
  });
});

describe("canonicalizeRow / parseImportNumber", () => {
  it("normalises headers regardless of case, spaces, underscores and hyphens", () => {
    expect(normalizeHeader("  Cost_Price ")).toBe("cost price");
    expect(normalizeHeader("SELLING-PRICE")).toBe("selling price");
    expect(canonicalizeRow({ "Cost  Price": "9", "sELLing price": "10" })).toEqual({ cost_price: "9", selling_price: "10" });
  });

  it("parses messy spreadsheet numbers and rejects blanks", () => {
    expect(parseImportNumber("₦1,500")).toBe(1500);
    expect(parseImportNumber("2,000.50")).toBe(2000.5);
    expect(parseImportNumber("")).toBeNaN();
    expect(parseImportNumber(undefined)).toBeNaN();
    expect(parseImportNumber("abc")).toBeNaN();
  });
});

describe("buildImportPlan expiry handling", () => {
  const full = (over: Record<string, string> = {}) =>
    ({ name: "P", sku: "S1", unit: "pcs", selling_price: "10", cost_price: "5", stock_quantity: "1", reorder_level: "5", ...over });

  it("carries expiry_date from the CSV, and omits it when the column is absent", () => {
    const withExp = buildImportPlan([full({ sku: "X1", expiry_date: "2026-12-31" })], [], 0, null);
    expect(withExp.inserts[0].expiry_date).toBe("2026-12-31");
    const without = buildImportPlan([full({ sku: "X2" })], [], 0, null);
    expect(without.inserts[0].expiry_date).toBeUndefined();
    const cleared = buildImportPlan([full({ sku: "X3", expiry_date: "" })], [], 0, null);
    expect(cleared.inserts[0].expiry_date).toBeNull();
  });
});

describe("buildImportPlan tax column", () => {
  const full = (over: Record<string, string> = {}) =>
    ({ name: "P", sku: "S1", unit: "pcs", selling_price: "10", cost_price: "5", stock_quantity: "1", reorder_level: "5", ...over });
  const taxes = [{ id: "vat-1", name: "VAT" }, { id: "ct-1", name: "Consumption Tax" }];

  it("maps a Tax name (case-insensitively) to its id", () => {
    const plan = buildImportPlan([full({ sku: "T1", Tax: "vat" })], [], 0, null, taxes);
    expect(plan.inserts[0].tax_id).toBe("vat-1");
  });

  it("treats blank / 'exempt' as Exempt (null)", () => {
    const blank = buildImportPlan([full({ sku: "T2", Tax: "" })], [], 0, null, taxes);
    expect(blank.inserts[0].tax_id).toBeNull();
    const exempt = buildImportPlan([full({ sku: "T3", Tax: "Exempt" })], [], 0, null, taxes);
    expect(exempt.inserts[0].tax_id).toBeNull();
  });

  it("rejects a row whose Tax name matches nothing in the catalogue", () => {
    const plan = buildImportPlan([full({ sku: "T4", Tax: "VATT" })], [], 0, null, taxes);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.rejected[0].reason).toMatch(/Unknown tax/);
  });

  it("leaves tax unchanged when the column is absent (undefined)", () => {
    const plan = buildImportPlan([full({ sku: "T5" })], [], 0, null, taxes);
    expect(plan.inserts[0].tax_id).toBeUndefined();
  });

  it("ignores the Tax column entirely when tax is disabled (no taxes passed)", () => {
    const plan = buildImportPlan([full({ sku: "T6", Tax: "VATT" })], [], 0, null);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].tax_id).toBeUndefined();
  });
});

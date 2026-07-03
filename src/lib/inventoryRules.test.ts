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
  const row = (sku: string, qty: string, name = "P") => ({ name, sku, stock_quantity: qty, selling_price: "10" });

  it("inserts new SKUs", () => {
    const plan = buildImportPlan([row("S1", "5")], [], 0, null);
    expect(plan.updates).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].sku).toBe("S1");
    expect(plan.inserts[0].stock_quantity).toBe(5);
  });

  it("restocks an existing SKU (case-insensitive) by adding quantity", () => {
    const plan = buildImportPlan([row("s1", "5")], [{ id: "e1", sku: "S1", stock_quantity: 3 }], 1, null);
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ id: "e1", fields: expect.objectContaining({ sku: "s1" }), stock: 8 }]);
  });

  it("merges duplicate SKUs within the same file (sums quantity, keeps last fields)", () => {
    const plan = buildImportPlan([row("S1", "5", "A"), row("s1", "2", "B")], [], 0, null);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].stock_quantity).toBe(7);
    expect(plan.inserts[0].name).toBe("B");
  });

  it("skips rows without an SKU", () => {
    const plan = buildImportPlan(
      [{ name: "no sku" }, row("S2", "1")],
      [],
      0,
      null,
    );
    expect(plan.skippedNoSku).toBe(1);
    expect(plan.inserts).toHaveLength(1);
  });

  it("applies the plan limit to new products only, never to restocks", () => {
    const plan = buildImportPlan(
      [row("S1", "5"), row("S2", "1"), row("S3", "1")],
      [{ id: "e1", sku: "S1", stock_quantity: 1 }],
      1,
      1,
    );
    expect(plan.updates).toHaveLength(1); // S1 restock allowed
    expect(plan.inserts).toHaveLength(0); // no capacity for new
    expect(plan.overLimit).toBe(2);
  });
});

describe("buildImportPlan header + number robustness", () => {
  it("maps human/case-varied headers onto the right fields (prices are not zeroed)", () => {
    const plan = buildImportPlan(
      [{ "Name": "Garri", "SKU": "G1", "Cost Price": "6000", "Selling Price": "8500", "Stock Quantity": "20", "Reorder Level": "5" }],
      [], 0, null,
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]).toMatchObject({
      name: "Garri", sku: "G1", cost_price: 6000, selling_price: 8500, reorder_level: 5, stock_quantity: 20,
    });
  });

  it("accepts common aliases (Product / Code / Price / Qty)", () => {
    const plan = buildImportPlan(
      [{ "Product": "Rice", "Code": "R1", "Price": "1200", "Qty": "3" }],
      [], 0, null,
    );
    expect(plan.inserts[0]).toMatchObject({ name: "Rice", sku: "R1", selling_price: 1200, stock_quantity: 3 });
  });

  it("strips currency symbols and thousands separators from numbers", () => {
    const plan = buildImportPlan(
      [{ "name": "A", "sku": "A1", "cost_price": "₦1,500", "selling_price": " 2,000.50 ", "stock_quantity": "1,000" }],
      [], 0, null,
    );
    expect(plan.inserts[0]).toMatchObject({ cost_price: 1500, selling_price: 2000.5 });
    expect(plan.inserts[0].stock_quantity).toBe(1000);
  });

  it("leaves a truly missing price at 0 rather than NaN", () => {
    const plan = buildImportPlan([{ "Name": "B", "SKU": "B1" }], [], 0, null);
    expect(plan.inserts[0].cost_price).toBe(0);
    expect(plan.inserts[0].selling_price).toBe(0);
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
  it("carries expiry_date from the CSV, and omits it when the column is absent", () => {
    const withExp = buildImportPlan([{ name: "A", sku: "X1", expiry_date: "2026-12-31" }], [], 0, null);
    expect(withExp.inserts[0].expiry_date).toBe("2026-12-31");
    const without = buildImportPlan([{ name: "B", sku: "X2" }], [], 0, null);
    expect(without.inserts[0].expiry_date).toBeUndefined();
    const cleared = buildImportPlan([{ name: "C", sku: "X3", expiry_date: "" }], [], 0, null);
    expect(cleared.inserts[0].expiry_date).toBeNull();
  });
});

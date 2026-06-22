import { describe, it, expect } from "vitest";
import { findSkuConflict, buildImportPlan } from "./inventoryRules";

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

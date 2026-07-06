import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const material = {
  id: "rm-1",
  business_id: "biz-1",
  name: "Cassava flour",
  sku: "CAS-1",
  unit: "kg",
  stock_quantity: 100,
  reorder_level: 10,
  cost_per_unit: 500,
  supplier_id: null,
  notes: null,
  created_at: "2026-06-01T00:00:00Z",
};

test.describe("Raw Materials", () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "raw_materials", [material]);
    await page.goto("/raw-materials");
  });

  test("lists materials", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Raw Materials" })).toBeVisible();
    // Scope to the desktop table — the responsive layout also renders a (hidden) mobile card.
    await expect(page.locator("table").getByText("Cassava flour")).toBeVisible();
  });

  test("shows the materials and deliveries tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /Materials/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Deliveries/ })).toBeVisible();
  });

  test("CSV import tolerates currency/commas, restocks by SKU and rejects unknown suppliers", async ({ page }) => {
    const csv = [
      "Name,SKU,Stock Quantity,Cost Per Unit,Supplier",
      'New Mat,NM-1,"1,500","₦1,200",',   // commas + currency parse fine -> insert
      "Restock,cas-1,50,600,",            // matches existing CAS-1 (case-insensitive) -> restock
      "Ghost Mat,GM-1,5,10,Ghost Ltd",    // supplier doesn't exist -> rejected with a reason
    ].join("\n");
    await page.locator('input[type="file"]').setInputFiles({ name: "materials.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(page.getByRole("heading", { name: "Import results" })).toBeVisible();
    await expect(page.getByText(/2 rows imported · 1 added · 1 restocked/)).toBeVisible();
    await expect(page.getByText(/1 row not imported/)).toBeVisible();
    await expect(page.getByText(/Supplier "Ghost Ltd" not found/)).toBeVisible();
  });
});

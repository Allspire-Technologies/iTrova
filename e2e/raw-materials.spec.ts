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
    await expect(page.getByText("Cassava flour")).toBeVisible();
  });

  test("shows the materials and deliveries tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /Materials/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Deliveries/ })).toBeVisible();
  });
});

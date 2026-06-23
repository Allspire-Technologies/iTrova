import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const product = {
  id: "prod-1",
  business_id: "biz-1",
  name: "Garri 50kg",
  category: "Foodstuff",
  sku: "GAR-50",
  unit: "bag",
  selling_price: 8500,
  cost_price: 6000,
  stock_quantity: 20,
  reorder_level: 5,
  created_at: "2026-06-01T00:00:00Z",
};

test.describe("Inventory", () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "products", [product]);
    await page.goto("/inventory");
  });

  test("lists products", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await expect(page.getByText("Garri 50kg")).toBeVisible();
    await expect(page.getByText("GAR-50")).toBeVisible();
  });

  test("opens the add-product dialog with a required SKU", async ({ page }) => {
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page.getByText("Add a new product")).toBeVisible();
    await expect(page.getByText("SKU / barcode *")).toBeVisible();
  });
});

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

test.describe("Point of Sale", () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await stubRows(page, "products", [product]);
    await page.goto("/pos");
  });

  test("shows the product grid and an empty cart", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Point of Sale" })).toBeVisible();
    await expect(page.getByText("Garri 50kg")).toBeVisible();
    await expect(page.getByText("Cart is empty")).toBeVisible();
  });

  test("adds a product to the cart", async ({ page }) => {
    await page.getByRole("button", { name: /Garri 50kg/ }).click();
    await expect(page.getByText("Cart is empty")).toBeHidden();
    await expect(page.getByText("1 item", { exact: true })).toBeVisible();
  });

  test("holds a sale and resumes it from the held-sales modal", async ({ page }) => {
    await page.getByRole("button", { name: /Garri 50kg/ }).click();
    await expect(page.getByText("1 item", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Hold sale", exact: true }).click();
    await expect(page.getByText("Cart is empty")).toBeVisible();

    await page.getByRole("button", { name: /Held sales \(1\)/ }).click();
    await page.getByRole("button", { name: "Resume" }).click();

    await expect(page.getByText("Cart is empty")).toBeHidden();
    await expect(page.getByText("1 item", { exact: true })).toBeVisible();
  });
});

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
    await expect(page.getByText("1 item", { exact: true }).filter({ visible: true })).toBeVisible();
  });

  test("holds a sale and resumes it from the held-sales modal", async ({ page }) => {
    await page.getByRole("button", { name: /Garri 50kg/ }).click();
    await expect(page.getByText("1 item", { exact: true }).filter({ visible: true })).toBeVisible();

    await page.getByRole("button", { name: "Hold sale", exact: true }).click();
    await expect(page.getByText("Cart is empty")).toBeVisible();

    await page.getByRole("button", { name: /Held sales \(1\)/ }).click();
    await page.getByRole("button", { name: "Resume" }).click();

    await expect(page.getByText("Cart is empty")).toBeHidden();
    await expect(page.getByText("1 item", { exact: true }).filter({ visible: true })).toBeVisible();
  });

  test("search matches SKU, case-insensitively", async ({ page }) => {
    const search = page.getByPlaceholder("Search products...");
    // "gar-50" is the lowercase SKU (GAR-50) and is NOT a substring of the name, so a match proves
    // the list search now looks at SKU (and isn't case-sensitive).
    await search.fill("gar-50");
    await expect(page.getByRole("button", { name: /Garri 50kg/ })).toBeVisible();
    await search.fill("zzz-none");
    await expect(page.getByRole("button", { name: /Garri 50kg/ })).toBeHidden();
  });

  test("scan by SKU adds the product to the cart (case-insensitive)", async ({ page }) => {
    const scan = page.getByPlaceholder("Scan or type SKU + Enter");
    await scan.fill("gar-50"); // lowercase of GAR-50
    await scan.press("Enter");
    await expect(page.getByText("1 item", { exact: true }).filter({ visible: true })).toBeVisible();
  });

  test.describe("on a mobile viewport", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("lays out the title/tabs/held row without horizontal overflow", async ({ page }) => {
      await page.getByRole("button", { name: /Garri 50kg/ }).click();
      // On mobile the cart lives in a bottom sheet — open it from the sticky bar to hold the sale.
      await page.getByRole("button", { name: /Review/ }).click();
      await page.getByRole("button", { name: "Hold sale", exact: true }).click();
      await expect(page.getByRole("button", { name: /Held sales \(1\)/ })).toBeVisible();
      await page.getByRole("button", { name: /Garri 50kg/ }).click();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
});

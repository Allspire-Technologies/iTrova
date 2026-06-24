import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

// Free plan that omits the reports + team modules.
const limitedPlan = {
  id: "pl-1", key: "free", name: "Free", description: null,
  price_amount: 0, price_currency: "NGN", billing_period: null,
  features: [], limits: {}, is_active: true, sort_order: 1,
  business_id: null, promo_percent: 0, promo_label: null, promo_until: null,
  modules: ["inventory", "pos", "suppliers", "invoices"],
  prices: [],
};

test.describe("Plan module gating", () => {
  test("the sidebar only shows modules the plan grants", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "plans", [limitedPlan]);
    await page.goto("/");
    // granted modules are visible
    await expect(page.getByRole("link", { name: "Inventory" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Point of Sale" })).toBeVisible();
    // modules not on the plan are hidden (owner role would otherwise allow them)
    await expect(page.getByRole("link", { name: "Reports" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Team" })).toHaveCount(0);
  });

  test("feature entitlements gate their buttons (CSV import/export)", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "plans", [limitedPlan]); // modules omit csv_import + csv_export
    await stubRows(page, "products", [
      { id: "p1", business_id: "biz-1", name: "Garri", category: "Food", sku: "G", unit: "bag", selling_price: 8500, cost_price: 6000, stock_quantity: 20, reorder_level: 5, created_at: "2026-06-01T00:00:00Z" },
    ]);
    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add product" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import CSV" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Export", exact: true })).toHaveCount(0);
  });
});

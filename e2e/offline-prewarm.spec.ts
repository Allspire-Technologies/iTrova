import { test, expect, type Page } from "@playwright/test";
import { authenticate } from "./support/auth";

const PRODUCT = {
  id: "prod-1", business_id: "biz-1", name: "Garri 50kg", sku: "GAR-50",
  selling_price: 8500, stock_quantity: 20, reorder_level: 5, category: "Foodstuff",
};

// Hold the products fetch open so the pre-warm stays "running" long enough to observe.
async function slowProducts(page: Page, ms: number) {
  await page.route("**/rest/v1/products**", async (r) => {
    await new Promise((res) => setTimeout(res, ms));
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

test.describe("Offline pre-warm", () => {
  test("shows the progress bar and gates sign-out until caching is done", async ({ page }) => {
    await authenticate(page, { onRoutes: (p) => slowProducts(p, 2500) });

    // The slim progress bar is visible while caching runs.
    await expect(page.getByText(/Preparing offline data/)).toBeVisible();

    // Signing out mid-pre-warm is gated, not allowed.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText("Finishing offline setup…")).toBeVisible();
    await page.getByRole("button", { name: "Stay signed in" }).click();

    // Once caching finishes, the bar clears.
    await expect(page.getByText(/Preparing offline data/)).toHaveCount(0, { timeout: 15000 });
  });

  test("pre-warms a module so it works offline without visiting it first", async ({ page }) => {
    // Products come back with real data during the pre-warm (no delay).
    await authenticate(page, {
      onRoutes: async (p) => {
        await p.route("**/rest/v1/products**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([PRODUCT]) }));
      },
    });

    // Wait for the pre-warm to finish caching.
    await expect(page.getByText("Offline data ready.")).toBeVisible({ timeout: 15000 });

    // Go offline and open Inventory — a page we never visited online this session.
    await page.route("**/auth/v1/health**", (r) => r.abort());
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.goto("/inventory");

    // The product is there, served from the pre-warmed cache.
    // Scope to the desktop table — Inventory also renders a (hidden) mobile card.
    await expect(page.locator("table").getByText("Garri 50kg")).toBeVisible();
  });

  test("offline POS hides out-of-stock products (Inventory still shows them)", async ({ page }) => {
    const inStock = { ...PRODUCT, id: "p-in", name: "Garri In Stock", stock_quantity: 12 };
    const outOfStock = { ...PRODUCT, id: "p-out", name: "Garri Out Of Stock", stock_quantity: 0 };
    await authenticate(page, {
      onRoutes: async (p) => {
        await p.route("**/rest/v1/products**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([inStock, outOfStock]) }));
      },
    });
    await expect(page.getByText("Offline data ready.")).toBeVisible({ timeout: 15000 });

    await page.route("**/auth/v1/health**", (r) => r.abort());
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    // POS shows only the in-stock product.
    await page.goto("/pos");
    await expect(page.getByText("Garri In Stock")).toBeVisible();
    await expect(page.getByText("Garri Out Of Stock")).toHaveCount(0);

    // Inventory (management view) still lists the out-of-stock one.
    await page.goto("/inventory");
    await expect(page.locator("table").getByText("Garri Out Of Stock")).toBeVisible();
  });
});

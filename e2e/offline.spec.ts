import { test, expect, type Page } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

// Force the connectivity probe to fail so the app treats the device as offline.
async function goOffline(page: Page) {
  await page.route("**/auth/v1/health**", (r) => r.abort()); // probe -> unreachable -> offline
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
}

test.describe("Offline gating (P1)", () => {
  test("shows the offline banner once disconnected", async ({ page }) => {
    await authenticate(page);
    await goOffline(page);
    await expect(page.getByText(/Offline — Point of Sale still works/i)).toBeVisible();
  });

  test("blocks a non-POS module with an offline notice", async ({ page }) => {
    await authenticate(page);
    await goOffline(page);
    await page.goto("/suppliers");
    await expect(page.getByText("You're offline")).toBeVisible();
    await expect(page.getByText(/needs an internet connection/i)).toBeVisible();
  });

  test("keeps POS reachable while offline (not gated)", async ({ page }) => {
    await authenticate(page);
    await goOffline(page);
    await page.goto("/pos");
    await expect(page.getByText("You're offline")).toHaveCount(0); // POS is never blocked
  });

  test("Dashboard stays viewable offline (read-only, not blocked)", async ({ page }) => {
    await authenticate(page); // online: caches a dashboard snapshot
    await goOffline(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Good day/ })).toBeVisible();
    await expect(page.getByText("You're offline")).toHaveCount(0); // read-only, not the block notice
  });

  test("captures a POS sale offline and shows pending sync", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await stubRows(page, "products", [
      { id: "prod-1", business_id: "biz-1", name: "Garri 50kg", category: "Foodstuff", sku: "GAR-50", unit: "bag", selling_price: 8500, cost_price: 6000, stock_quantity: 20, reorder_level: 5, created_at: "2026-06-01T00:00:00Z" },
    ]);
    await page.goto("/pos"); // online: loads + caches products
    await page.getByRole("button", { name: /Garri 50kg/ }).click(); // add to cart

    await goOffline(page); // no reload — state flips to offline, cart persists
    await page.getByRole("button", { name: "Complete sale" }).click();

    await expect(page.getByRole("button", { name: "New sale" })).toBeVisible(); // receipt opened
    await page.getByRole("button", { name: "New sale" }).click(); // close receipt
    await expect(page.getByText(/Pending sync \(1\)/)).toBeVisible();
    await expect(page.getByText("Cart is empty")).toBeVisible();
  });
});

import { test, expect, type Page } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

// Force the connectivity probe to fail so the app treats the device as offline.
async function goOffline(page: Page) {
  await page.route("**/auth/v1/health**", (r) => r.abort()); // probe -> unreachable -> offline
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
}

// Restore connectivity and route the offline-sale commit RPC.
async function goOnline(page: Page, commit: (route: import("@playwright/test").Route) => unknown) {
  await page.route("**/auth/v1/health**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.route("**/rest/v1/rpc/commit_offline_sale**", commit);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

const PRODUCT = { id: "prod-1", business_id: "biz-1", name: "Garri 50kg", category: "Foodstuff", sku: "GAR-50", unit: "bag", selling_price: 8500, cost_price: 6000, stock_quantity: 20, reorder_level: 5, created_at: "2026-06-01T00:00:00Z" };

// Authenticate (owner), capture one sale while offline, end with "Pending sync (1)" showing.
async function captureOfflineSale(page: Page) {
  await authenticate(page);
  await stubRows(page, "products", [PRODUCT]);
  await page.goto("/pos");
  await page.getByRole("button", { name: /Garri 50kg/ }).click();
  await goOffline(page);
  await page.getByRole("button", { name: "Complete sale" }).click();
  await page.getByRole("button", { name: "New sale" }).click(); // close receipt
  await expect(page.getByText(/Pending sync \(1\)/)).toBeVisible();
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

  test("syncs queued offline sales when the user taps Sync now", async ({ page }) => {
    await captureOfflineSale(page);
    await goOnline(page, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "committed", invoice_number: "260628-1" }) }),
    );
    await page.getByRole("button", { name: "Sync now" }).click(); // manual sync
    await expect(page.getByText(/Pending sync/)).toHaveCount(0); // drained
  });

  test("flags a sale for review when the server can't satisfy stock", async ({ page }) => {
    await captureOfflineSale(page);
    await goOnline(page, (r) =>
      r.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "NEEDS_REVIEW:Garri 50kg", code: "23514" }) }),
    );
    await page.getByRole("button", { name: "Sync now" }).click();
    await expect(page.getByRole("button", { name: /Needs review \(1\)/ })).toBeVisible();
    await expect(page.getByText(/Pending sync/)).toHaveCount(0); // moved out of the pending queue
  });

  test("blocks sign-out while offline sales are unsynced", async ({ page }) => {
    await captureOfflineSale(page); // 1 pending sale, still offline
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByText("Sync before signing out")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stay signed in" })).toBeVisible();
    // Offline -> Sync now is disabled (can't upload without internet).
    await expect(page.getByRole("button", { name: "Sync now" })).toBeDisabled();
  });
});

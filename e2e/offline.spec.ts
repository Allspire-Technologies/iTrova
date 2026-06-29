import { test, expect, type Page } from "@playwright/test";
import { authenticate } from "./support/auth";

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
});

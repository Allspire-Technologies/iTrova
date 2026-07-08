import { test, expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { authenticate } from "./support/auth";
import { FAKE_USER } from "./support/supabase";

// A VAT-registered business: re-route /businesses so tax_enabled is on (authenticate's default is off).
function taxEnabledBusiness(page: Page) {
  const business = {
    id: "biz-1", name: "Sunrise Stores", owner_id: FAKE_USER.id, currency: "NGN",
    timezone: "Africa/Lagos", subscription_tier: "free", whatsapp_number: null,
    created_at: "2026-06-01T00:00:00Z",
    tax_enabled: true, prices_include_tax: true, tin: "12345678-0001",
  };
  return page.route("**/rest/v1/businesses**", (r: Route) => {
    const accept = r.request().headers()["accept"] || "";
    return r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(accept.includes("vnd.pgrst.object") ? business : [business]),
    });
  });
}

test.describe("Tax (VAT)", () => {
  test("owner sees the Tax card in Settings; off by default", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/settings");
    await expect(page.getByText("Tax (VAT)", { exact: true })).toBeVisible();
    await expect(page.getByText("Charge tax", { exact: true })).toBeVisible();
    // Off by default → the inclusive/TIN/catalogue controls stay hidden.
    await expect(page.getByText("Prices include tax", { exact: true })).toHaveCount(0);
  });

  test("when tax is enabled, Settings reveals inclusive toggle, TIN and the taxes catalogue", async ({ page }) => {
    await authenticate(page, { role: "owner", onRoutes: taxEnabledBusiness });
    await page.goto("/settings");
    await expect(page.getByText("Prices include tax", { exact: true })).toBeVisible();
    await expect(page.getByText("Tax ID (TIN)", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add VAT (7.5%)" })).toBeVisible();
  });

  test("Dashboard shows the VAT Collected tile only when tax is enabled", async ({ page }) => {
    await authenticate(page, { role: "owner", onRoutes: taxEnabledBusiness });
    await page.goto("/");
    await expect(page.getByText("VAT Collected", { exact: true })).toBeVisible();
  });

  test("Dashboard hides the VAT tile when tax is off", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/");
    await expect(page.getByText("Today's Sales", { exact: true })).toBeVisible();
    await expect(page.getByText("VAT Collected", { exact: true })).toHaveCount(0);
  });
});

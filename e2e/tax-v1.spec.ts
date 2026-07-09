import { test, expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";
import { FAKE_USER } from "./support/supabase";

// A VAT-registered business (authenticate's default has tax off).
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

const VAT = { id: "tax-vat", business_id: "biz-1", name: "VAT", rate: 7.5, is_default: true, active: true, created_at: "2026-06-01T00:00:00Z" };
const FLOUR = { id: "m1", business_id: "biz-1", name: "Cassava Flour", sku: "CF-01", unit: "kg", stock_quantity: 50, reorder_level: 10, cost_per_unit: 1200, supplier_id: "s1", notes: null, created_at: "2026-06-01T00:00:00Z" };
const SUPPLIER = { id: "s1", business_id: "biz-1", name: "Olu Farms", phone: null, email: null, address: null, notes: null, created_at: "2026-06-01T00:00:00Z" };

test.describe("Tax v1 — input VAT on procurement", () => {
  test("Raw Materials purchase dialog captures input VAT and sends tax_amount", async ({ page }) => {
    await authenticate(page, { role: "owner", onRoutes: taxEnabledBusiness });
    await stubRows(page, "taxes", [VAT]);
    await stubRows(page, "raw_materials", [FLOUR]);
    await stubRows(page, "suppliers", [SUPPLIER]);

    let insertBody: any = null;
    await page.route("**/rest/v1/material_purchases**", (r) => {
      if (r.request().method() === "POST") {
        insertBody = r.request().postDataJSON();
        return r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify([{ id: "mp1" }]) });
      }
      return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });

    await page.goto("/raw-materials");
    await page.getByRole("button", { name: "Purchase" }).first().click();
    // The input-VAT field only appears because tax is enabled.
    await expect(page.getByText("of which VAT", { exact: false })).toBeVisible();
    // Dialog number inputs, in order: Quantity, Unit cost (prefilled 1200), of-which-VAT.
    const nums = page.getByRole("dialog").locator('input[type="number"]');
    await nums.nth(0).fill("100");
    await nums.nth(2).fill("8372");
    await page.getByRole("button", { name: "Add to stock" }).click();
    await expect.poll(() => insertBody).not.toBeNull();
    expect(Number(insertBody.tax_amount)).toBe(8372);
    expect(Number(insertBody.total_cost)).toBe(120000);
  });

  test("Purchase Order create dialog shows the input-VAT field when tax is enabled", async ({ page }) => {
    await authenticate(page, { role: "owner", onRoutes: taxEnabledBusiness });
    await stubRows(page, "taxes", [VAT]);
    await stubRows(page, "purchase_orders", []);
    await stubRows(page, "suppliers", [SUPPLIER]);
    await stubRows(page, "raw_materials", [FLOUR]);
    await stubRows(page, "products", []);

    await page.goto("/purchase-orders");
    await page.getByRole("button", { name: "New PO" }).first().click();
    await expect(page.getByText("of which VAT (input):", { exact: false })).toBeVisible();
  });
});

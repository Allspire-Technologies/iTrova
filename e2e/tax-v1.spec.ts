import { test, expect } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { readFileSync } from "fs";
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

  test("printed invoice receipt shows VAT + TIN, and subtotal + VAT = total", async ({ page }) => {
    await authenticate(page, { role: "owner", onRoutes: taxEnabledBusiness });
    // Capture the receipt HTML the page writes into the print window (avoids the popup auto-close race).
    await page.addInitScript(() => {
      (window as unknown as { __receipt: string }).__receipt = "";
      window.open = () => ({
        document: { write: (h: string) => { (window as unknown as { __receipt: string }).__receipt += h; }, close: () => {} },
        close: () => {},
      }) as unknown as Window;
    });
    const invoice = {
      id: "inv-1", business_id: "biz-1", invoice_number: "INV-009", customer_name: "Ada",
      customer_phone: null, customer_email: null, status: "paid", subtotal: 25000, tax: 1744,
      discount_amount: 0, total: 25000, issue_date: "2026-06-23", due_date: null, notes: null,
      sale_id: "sale-1", created_by: null, created_at: "2026-06-23T00:00:00Z",
    };
    await stubRows(page, "invoices", [invoice]);
    await stubRows(page, "invoice_items", [{ id: "it1", invoice_id: "inv-1", description: "Garri 50kg", quantity: 2, unit_price: 12500, line_total: 25000 }]);

    await page.goto("/invoices");
    await page.locator("table").getByRole("button", { name: "Print", exact: true }).click();
    // printReceipt is async (loads items + payment breakdown before writing the window) — wait for it.
    await page.waitForFunction(() => (window as unknown as { __receipt: string }).__receipt.length > 0);
    const html = await page.evaluate(() => (window as unknown as { __receipt: string }).__receipt);
    expect(html).toContain("VAT");
    expect(html).toContain("TIN: 12345678-0001");
    expect(html).toMatch(/23[,]?256/); // net subtotal = total(25000) − VAT(1744), so subtotal + VAT = total
    expect(html).toMatch(/1[,]?744/);  // VAT
  });

  test("View invoice dialog shows a net subtotal so subtotal + VAT = total", async ({ page }) => {
    await authenticate(page, { role: "owner", onRoutes: taxEnabledBusiness });
    const invoice = {
      id: "inv-1", business_id: "biz-1", invoice_number: "INV-009", customer_name: "Ada",
      customer_phone: null, customer_email: null, status: "paid", subtotal: 25000, tax: 1744,
      discount_amount: 0, total: 25000, issue_date: "2026-06-23", due_date: null, notes: null,
      sale_id: "sale-1", created_by: null, created_at: "2026-06-23T00:00:00Z", amount_paid: 25000,
    };
    await stubRows(page, "invoices", [invoice]);
    await stubRows(page, "invoice_items", [{ id: "it1", invoice_id: "inv-1", description: "Garri 50kg", quantity: 2, unit_price: 12500, line_total: 25000 }]);

    await page.goto("/invoices");
    await page.locator("table").getByRole("button", { name: "View" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Subtotal: .*23[,]?256/)).toBeVisible(); // net = total − VAT
    await expect(dialog.getByText(/VAT: .*1[,]?744/)).toBeVisible();
    await expect(dialog.getByText(/Total: .*25[,]?000/)).toBeVisible();
  });

  test("Edit invoice dialog shows a net subtotal + VAT that add up to the total", async ({ page }) => {
    await authenticate(page, { role: "owner", onRoutes: taxEnabledBusiness });
    const invoice = {
      id: "inv-1", business_id: "biz-1", invoice_number: "INV-009", customer_name: "Ada",
      customer_phone: null, customer_email: null, status: "paid", subtotal: 25000, tax: 1744,
      discount_amount: 0, total: 25000, issue_date: "2026-06-23", due_date: null, notes: null,
      sale_id: "sale-1", created_by: null, created_at: "2026-06-23T00:00:00Z", amount_paid: 25000,
    };
    await stubRows(page, "invoices", [invoice]);
    // POS invoices (sale_id set) load their lines from the sale, so stub sale_items.
    await stubRows(page, "sale_items", [{ id: "si-1", product_id: "p1", quantity: 2, unit_price: 12500, products: { name: "Garri 50kg" } }]);

    await page.goto("/invoices");
    await page.locator("table").getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Subtotal: .*23[,]?256/)).toBeVisible(); // net = total − VAT
    await expect(dialog.getByText(/VAT: .*1[,]?744/)).toBeVisible();
    await expect(dialog.getByText(/Total: .*25[,]?000/)).toBeVisible();
  });

  test("downloading a VAT invoice generates the PDF in-browser", async ({ page }) => {
    await authenticate(page, { role: "owner", onRoutes: taxEnabledBusiness });
    const invoice = {
      id: "inv-1", business_id: "biz-1", invoice_number: "INV-009", customer_name: "Ada",
      customer_phone: null, customer_email: null, status: "paid", subtotal: 25000, tax: 1744,
      discount_amount: 0, total: 25000, issue_date: "2026-06-23", due_date: null, notes: null,
      sale_id: "sale-1", created_by: null, created_at: "2026-06-23T00:00:00Z", amount_paid: 25000,
    };
    await stubRows(page, "invoices", [invoice]);
    await stubRows(page, "invoice_items", [{ id: "it1", invoice_id: "inv-1", description: "Garri 50kg", quantity: 2, unit_price: 12500, line_total: 25000 }]);

    await page.goto("/invoices");
    await page.locator("table").getByRole("button", { name: "View" }).click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("dialog").getByRole("button", { name: "Download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("INV-009.pdf");
    // The generated PDF must print the ASCII currency code, not the ₦ glyph (tofu in the PDF font).
    const path = await download.path();
    const pdf = readFileSync(path).toString("latin1");
    expect(pdf).toContain("NGN");
    expect(pdf).not.toContain("₦");
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

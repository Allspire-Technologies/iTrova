import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const REC = {
  id: "ei-1", business_id: "biz-1", invoice_number: "ACME/EXP/2026/001", invoice_date: "2026-06-08",
  country_of_origin: "Nigeria", currency: "NGN", seller_name: "Sunrise Stores", seller_address: "", seller_email: "",
  seller_phone: "", seller_rc: "", buyer_name: "MR Cash and Carry", buyer_address: "", buyer_country: "Canada",
  items: [], subtotal: 0, total: 31927000, total_cartons: 362, mode_of_shipment: "Sea Freight", delivery_terms: "EXW",
  packaging: "", payment_terms: "", bank_name: "", account_name: "", account_number: "", swift: "", amount_in_words: "",
  notes: "", created_at: "2026-06-08T00:00:00Z",
};

test.describe("Export Invoice", () => {
  test("owner: the list has a New button that opens the form", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await expect(page.getByRole("link", { name: "Export Invoice" })).toBeVisible();
    await page.goto("/export-invoice");
    await expect(page.getByRole("heading", { name: "Export Invoices" })).toBeVisible();
    await page.getByRole("button", { name: "New export invoice" }).first().click();
    await expect(page).toHaveURL(/\/export-invoice\/new$/);
    await expect(page.getByRole("heading", { name: "New Export Invoice" })).toBeVisible();
  });

  test("the invoice number is shown (suggested) and editable; totals compute", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.route("**/rest/v1/rpc/next_export_invoice_number**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify("ACME/EXP/2026/005") }));
    await page.goto("/export-invoice/new");

    const num = page.getByLabel("Invoice number");
    await expect(num).toHaveValue("ACME/EXP/2026/005");
    await num.fill("CUSTOM-42");
    await expect(num).toHaveValue("CUSTOM-42");

    await page.getByLabel("Description 1").fill("Mixed Spices");
    await page.getByLabel("Boxes 1").fill("10");
    await page.getByLabel("Unit price 1").fill("168000");
    await expect(page.getByLabel("Line total 1")).toHaveValue("NGN 1,680,000.00");
    await expect(page.getByText(/Total cartons/)).toContainText("10");
    // Both export formats are offered.
    await expect(page.getByRole("button", { name: /Save & PDF/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Save & DOCX/ })).toBeVisible();
  });

  test("selecting a product fills its inventory price; a manager can't change it", async ({ page }) => {
    await authenticate(page, { role: "manager" });
    await stubRows(page, "products", [{ id: "p1", name: "Mixed Spices", stock_quantity: 500, unit: "pcs", selling_price: 168000 }]);
    await page.goto("/export-invoice/new");
    await page.getByLabel("Product 1").selectOption({ label: "Mixed Spices" });
    await expect(page.getByLabel("Unit price 1")).toHaveValue("168000");
    await expect(page.getByLabel("Unit price 1")).toBeDisabled();
  });

  test("anyone can open the read-only view from the list", async ({ page }) => {
    await authenticate(page, { role: "manager" });
    await stubRows(page, "export_invoices", [{ ...REC, items: [{ product_id: null, description: "Mixed Spices", size: "100g", units_per_box: 48, boxes: 10, unit_price: 168000, total: 1680000 }] }]);
    await page.goto("/export-invoice");
    await page.getByRole("button", { name: "View" }).click();
    await expect(page).toHaveURL(/\/export-invoice\/ei-1$/);
    await expect(page.getByRole("heading", { name: "ACME/EXP/2026/001" })).toBeVisible();
    await expect(page.getByText("Mixed Spices")).toBeVisible();
    await expect(page.getByText("MR Cash and Carry").first()).toBeVisible();
    // Managers can view + download but not edit.
    await expect(page.getByRole("button", { name: "DOCX" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  });

  test("owner can open a saved invoice to edit (prefilled)", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "export_invoices", [REC]);
    await page.goto("/export-invoice");
    await expect(page.getByText("ACME/EXP/2026/001")).toBeVisible();
    // Edit lives in the row's More-actions menu (max-3-actions rule).
    await page.getByRole("button", { name: "More actions for ACME/EXP/2026/001" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    await expect(page).toHaveURL(/\/export-invoice\/ei-1\/edit$/);
    await expect(page.getByRole("heading", { name: "Edit Export Invoice" })).toBeVisible();
    await expect(page.getByLabel("Invoice number")).toHaveValue("ACME/EXP/2026/001");
    await expect(page.getByPlaceholder("Importer company name")).toHaveValue("MR Cash and Carry");
  });

  test("a manager sees no Edit or Delete action on the list", async ({ page }) => {
    await authenticate(page, { role: "manager" });
    await stubRows(page, "export_invoices", [REC]);
    await page.goto("/export-invoice");
    await expect(page.getByText("ACME/EXP/2026/001")).toBeVisible();
    // The More-actions menu only offers DOCX for a manager — no Edit/Delete items.
    await page.getByRole("button", { name: "More actions for ACME/EXP/2026/001" }).click();
    await expect(page.getByRole("menuitem", { name: "Download DOCX" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
  });

  test("owner can delete a saved invoice (returns stock)", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "export_invoices", [REC]);
    let called = false;
    await page.route("**/rest/v1/rpc/delete_export_invoice**", (r) => {
      called = true;
      return r.fulfill({ status: 200, contentType: "application/json", body: "null" });
    });
    await page.goto("/export-invoice");
    await page.getByRole("button", { name: "More actions for ACME/EXP/2026/001" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    // Confirm dialog warns about returning stock, then deletes.
    await expect(page.getByText(/returns the stock/i)).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("Export invoice ACME/EXP/2026/001 deleted")).toBeVisible();
    expect(called).toBe(true);
  });

  test("a cashier cannot reach the module", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await expect(page.getByRole("link", { name: "Export Invoice" })).toHaveCount(0);
  });
});

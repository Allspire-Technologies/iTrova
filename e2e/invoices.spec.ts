import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const paidInvoice = {
  id: "inv-1",
  business_id: "biz-1",
  invoice_number: "INV-001",
  customer_name: "Ada",
  customer_phone: null,
  customer_email: null,
  status: "paid",
  subtotal: 25000,
  tax: 0,
  discount_amount: 0,
  total: 25000,
  issue_date: "2026-06-23",
  due_date: null,
  notes: null,
  sale_id: "sale-1",
  created_by: null,
  created_at: "2026-06-23T00:00:00Z",
};

test.describe("Invoices", () => {
  test("mobile: an overdue invoice card lays out without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await authenticate(page, { role: "owner" });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await stubRows(page, "invoices", [{ ...paidInvoice, sale_id: null, status: "issued", due_date: yesterday }]);
    await page.goto("/invoices");
    await expect(page.getByText("Overdue").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("owner sees the list with create and export actions", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "New invoice" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  });

  test("cashier can create but cannot export CSV", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Invoices", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "New invoice" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toHaveCount(0);
  });

  test("shows the split payment methods on a POS invoice's view", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "invoices", [paidInvoice]); // sale_id: sale-1 → payment from sale_payments
    await page.route("**/rest/v1/sale_payments**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ method: "cash", amount: 15000 }, { method: "transfer", amount: 10000 }]) }));
    await page.goto("/invoices");
    await page.getByRole("button", { name: "View" }).click();
    await expect(page.getByText(/Payment: Cash .* Transfer/)).toBeVisible();
  });

  test("any user can print a paid invoice receipt", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await stubRows(page, "invoices", [paidInvoice]);
    await page.goto("/invoices");
    // Scope to the desktop table — the responsive layout also renders a (hidden) mobile card.
    await expect(page.locator("table").getByText("INV-001")).toBeVisible();
    await expect(page.getByRole("button", { name: "Print", exact: true })).toBeVisible();
  });

  test("download and delete live in the actions menu", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "invoices", [paidInvoice]);
    await page.goto("/invoices");
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Download", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  });

  test("deleting a POS invoice reverses the sale via the delete_invoice RPC", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "invoices", [paidInvoice]);
    // Capture the RPC the delete routes through — it must be delete_invoice (which reverses the sale),
    // not a bare invoices DELETE (which would leave the sale counting on the dashboard).
    let rpcBody: unknown = null;
    await page.route("**/rest/v1/rpc/delete_invoice**", (r) => {
      rpcBody = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: "application/json", body: "null" });
    });
    await page.goto("/invoices");
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    // The confirm copy warns a POS invoice's stock is returned (sale_id is set on this invoice).
    await expect(page.getByText(/returned to inventory/i)).toBeVisible();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Invoice deleted")).toBeVisible();
    expect(rpcBody).toEqual({ _invoice_id: "inv-1" });
  });

  test("an owner/manager can edit the discount on a POS invoice", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "invoices", [paidInvoice]); // paidInvoice has a sale_id (POS-originated)
    // POS invoices load their lines from the sale (locked product + price; quantity/discount editable).
    await stubRows(page, "sale_items", [
      { id: "si-1", product_id: "p1", quantity: 1, unit_price: 25000, products: { name: "Garri 50kg" } },
    ]);
    await page.goto("/invoices");
    // Paid invoice → Print holds the visible slot; Edit lives in the More-actions menu.
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog");
    // The product line is locked to its sale-time name; the discount is still editable.
    await expect(dialog.getByText("Garri 50kg")).toBeVisible();
    await expect(dialog.locator("#inv-discount")).toBeEnabled();
    await dialog.locator("#inv-discount").fill("5000");
    await expect(dialog.getByText(/Total:\s*\D*20,000/)).toBeVisible();
  });

  test("a discount on a new custom-line invoice nets off the total", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();
    const dialog = page.getByRole("dialog");
    // A fresh line is a product picker; switch it to a free-text custom item.
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /Custom item/ }).click();
    await dialog.getByPlaceholder("Custom item / service").fill("Consulting");
    await dialog.getByPlaceholder("Qty").fill("2");
    await dialog.getByPlaceholder("Unit price").fill("10000"); // subtotal 20,000
    await dialog.locator("#inv-discount").fill("5000");
    await expect(dialog.getByText(/Subtotal:\s*\D*20,000/)).toBeVisible();
    await expect(dialog.getByText(/Discount:\s*-\D*5,000/)).toBeVisible();
    await expect(dialog.getByText(/Total:\s*\D*15,000/)).toBeVisible();
  });

  test("invoicing an inventory product saves via save_invoice with the product + quantity", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "products", [
      { id: "p1", name: "Bag of rice", selling_price: 5000, cost_price: 3000, stock_quantity: 10 },
    ]);
    let saveBody: { _payload?: { items?: { product_id: string | null; quantity: number }[] } } | null = null;
    await page.route("**/rest/v1/rpc/save_invoice**", (r) => {
      saveBody = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ invoice_id: "inv-x", invoice_number: "INV-009" }) });
    });
    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").first().fill("Ada"); // customer name
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /Bag of rice/ }).click();
    // Price auto-fills from the product's selling price; set a quantity within stock.
    await dialog.getByPlaceholder("Qty").fill("3");
    await expect(dialog.getByText("10 in stock", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Create invoice" }).click();
    await expect(page.getByText(/INV-009 created/)).toBeVisible();
    expect(saveBody?._payload?.items?.[0]).toMatchObject({ product_id: "p1", quantity: 3 });
  });

  test("overselling an inventory line is blocked (save_invoice never called)", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "products", [
      { id: "p1", name: "Bag of rice", selling_price: 5000, cost_price: 3000, stock_quantity: 2 },
    ]);
    let called = false;
    await page.route("**/rest/v1/rpc/save_invoice**", (r) => {
      called = true;
      return r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").first().fill("Ada");
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /Bag of rice/ }).click();
    await dialog.getByPlaceholder("Qty").fill("5"); // only 2 in stock
    await expect(dialog.getByText(/Only 2 in stock/)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Create invoice" })).toBeDisabled();
    expect(called).toBe(false);
  });

  test("saving as draft asks for status 'draft' — the server takes no stock for it", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "products", [
      { id: "p1", name: "Bag of rice", selling_price: 5000, cost_price: 3000, stock_quantity: 10 },
    ]);
    let saveBody: { _payload?: { status?: string | null } } | null = null;
    await page.route("**/rest/v1/rpc/save_invoice**", (r) => {
      saveBody = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ invoice_id: "inv-d", invoice_number: "INV-010", status: "draft" }) });
    });
    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").first().fill("Ada");
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /Bag of rice/ }).click();
    await dialog.getByPlaceholder("Qty").fill("3");
    await dialog.getByRole("button", { name: "Save as draft" }).click();
    expect(saveBody?._payload?.status).toBe("draft");
  });

  test("a draft can be saved even when the lines exceed available stock", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "products", [
      { id: "p1", name: "Bag of rice", selling_price: 5000, cost_price: 3000, stock_quantity: 2 },
    ]);
    await page.route("**/rest/v1/rpc/save_invoice**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ invoice_id: "inv-d", invoice_number: "INV-011", status: "draft" }) }));
    await page.goto("/invoices");
    await page.getByRole("button", { name: "New invoice" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").first().fill("Ada");
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /Bag of rice/ }).click();
    await dialog.getByPlaceholder("Qty").fill("5"); // more than the 2 in stock
    // Issuing is blocked by the oversell guard, but a draft reserves nothing, so it stays available.
    await expect(dialog.getByRole("button", { name: "Create invoice" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Save as draft" })).toBeEnabled();
  });
});

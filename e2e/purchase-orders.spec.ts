import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const RICE = { id: "p1", business_id: "biz-1", name: "Rice 25kg", unit: "bag", cost_price: 6000, selling_price: 8000, category: null, sku: "R25", stock_quantity: 5, reorder_level: 1, created_at: "2026-06-01T00:00:00Z" };
const CASSAVA = { id: "m1", business_id: "biz-1", name: "Cassava", sku: "CV", unit: "kg", stock_quantity: 50, reorder_level: 10, cost_per_unit: 1200, supplier_id: null, notes: null, created_at: "2026-06-01T00:00:00Z" };

test.describe("Purchase Orders", () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/purchase-orders");
  });

  test("the per-line source toggle filters the item dropdown (Inventory / Raw material / Custom)", async ({ page }) => {
    await stubRows(page, "products", [RICE]);
    await stubRows(page, "raw_materials", [CASSAVA]);
    await page.reload();
    await page.getByRole("button", { name: "New PO" }).click();
    const dialog = page.getByRole("dialog");

    // Default source = Inventory → the item dropdown lists products only.
    await dialog.getByRole("combobox").nth(1).click(); // 0 = supplier, 1 = line item picker
    await expect(page.getByRole("option", { name: "Rice 25kg" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Cassava" })).toHaveCount(0);
    await page.getByRole("option", { name: "Rice 25kg" }).click();

    // Switch the line to Raw material → the same dropdown now lists materials only.
    await dialog.getByRole("radio", { name: "Raw material" }).click();
    await dialog.getByRole("combobox").nth(1).click();
    await expect(page.getByRole("option", { name: "Cassava" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Rice 25kg" })).toHaveCount(0);

    // Custom → no dropdown, a manual description input instead.
    await dialog.getByRole("radio", { name: "Custom" }).click();
    await expect(dialog.getByRole("combobox")).toHaveCount(1); // only the supplier picker remains
    await expect(dialog.getByPlaceholder("Item description")).toBeVisible();
  });

  test("creating a PO sends product_id for an Inventory line and raw_material_id for a material line", async ({ page }) => {
    await stubRows(page, "products", [RICE]);
    await stubRows(page, "raw_materials", [CASSAVA]);
    await page.reload();
    await page.route("**/rest/v1/rpc/next_doc_number**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify("PO-0007") }));
    await page.route("**/rest/v1/purchase_orders**", (r) => {
      if (r.request().method() === "POST") return r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "po-9", po_number: "PO-0007" }) });
      return r.fallback();
    });
    let itemsBody: any = null;
    await page.route("**/rest/v1/purchase_order_items**", (r) => {
      if (r.request().method() === "POST") { itemsBody = r.request().postDataJSON(); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
      return r.fallback();
    });

    await page.getByRole("button", { name: "New PO" }).click();
    const dialog = page.getByRole("dialog");
    // Line 1 — Inventory (default): pick Rice.
    await dialog.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Rice 25kg" }).click();
    // Line 2 — switch to Raw material: pick Cassava.
    await dialog.getByRole("button", { name: "Add line" }).click();
    await dialog.getByRole("radio", { name: "Raw material" }).nth(1).click();
    await dialog.getByRole("combobox").nth(2).click();
    await page.getByRole("option", { name: "Cassava" }).click();

    await dialog.getByRole("button", { name: "Create PO" }).click();
    await expect(page.getByText(/Purchase order PO-0007 created/)).toBeVisible();
    expect(itemsBody).not.toBeNull();
    expect(itemsBody[0].product_id).toBe("p1");
    expect(itemsBody[0].raw_material_id).toBeNull();
    expect(itemsBody[1].raw_material_id).toBe("m1");
    expect(itemsBody[1].product_id).toBeNull();
  });

  test("renders the page with an empty state", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Purchase Orders" })).toBeVisible();
    await expect(page.getByText("No purchase orders yet.")).toBeVisible();
  });

  test("enables the CSV template and import buttons", async ({ page }) => {
    await expect(page.getByRole("button", { name: /CSV Template/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Import CSV/ })).toBeEnabled();
  });

  test("CSV import groups rows by Order Ref into one PO and rejects bad rows", async ({ page }) => {
    await page.route("**/rest/v1/rpc/next_doc_number**", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify("PO-0001") }));
    await page.route("**/rest/v1/purchase_orders**", async (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "po-1", po_number: "PO-0001" }) });
      }
      return route.fallback();
    });

    const csv = [
      "Order Ref,Supplier,Expected Date,Description,Quantity,Unit Cost,Notes",
      'GRP-1,,2026-08-01,Flour,10,"8,500",First batch', // same ref ->
      "grp-1,,,Sugar,4,12000,",                          // ...one PO with two lines
      ",,,No Qty Row,,5,",                               // missing quantity -> rejected
    ].join("\n");
    await page.locator('input[type="file"]').setInputFiles({ name: "pos.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(page.getByRole("heading", { name: "Import results" })).toBeVisible();
    await expect(page.getByText(/2 rows imported · 1 purchase order created/)).toBeVisible();
    await expect(page.getByText(/1 row not imported/)).toBeVisible();
    await expect(page.getByText(/Missing Quantity/)).toBeVisible();
  });
});

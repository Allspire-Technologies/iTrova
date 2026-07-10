import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { authenticate, stubRows } from "./support/auth";

const RICE = { id: "p1", business_id: "biz-1", name: "Rice 25kg", unit: "bag", cost_price: 6000, selling_price: 8000, category: null, sku: "R25", stock_quantity: 5, reorder_level: 1, created_at: "2026-06-01T00:00:00Z" };
const CASSAVA = { id: "m1", business_id: "biz-1", name: "Cassava", sku: "CV", unit: "kg", stock_quantity: 50, reorder_level: 10, cost_per_unit: 1200, supplier_id: null, notes: null, created_at: "2026-06-01T00:00:00Z" };

// A received PO carrying input VAT: total 107,500 of which 7,500 VAT → net subtotal 100,000.
const PO_WITH_TAX = { id: "po-1", business_id: "biz-1", po_number: "PO-0007", supplier_id: null, status: "draft", expected_date: null, total_amount: 107500, notes: null, created_at: "2026-06-01T00:00:00Z", tax_amount: 7500 };
const PO_ITEM = { id: "poi1", purchase_order_id: "po-1", product_id: null, raw_material_id: null, description: "Flour", quantity: 10, unit_cost: 10750, line_total: 107500 };

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

  test("View dialog shows a net subtotal + VAT that add up to the total", async ({ page }) => {
    await stubRows(page, "purchase_orders", [PO_WITH_TAX]);
    await stubRows(page, "purchase_order_items", [PO_ITEM]);
    await page.reload();
    await page.locator("table").getByRole("button", { name: "View" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Subtotal: .*100,?000/)).toBeVisible(); // net = total − VAT
    await expect(dialog.getByText(/VAT: .*7,?500/)).toBeVisible();
    await expect(dialog.getByText(/Total: .*107,?500/)).toBeVisible();
  });

  test("Download PDF includes the VAT line and net subtotal", async ({ page }) => {
    await stubRows(page, "purchase_orders", [PO_WITH_TAX]);
    await stubRows(page, "purchase_order_items", [PO_ITEM]);
    await page.reload();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("table").getByRole("button", { name: "PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("PO-0007.pdf");
    const pdf = readFileSync(await download.path()).toString("latin1");
    expect(pdf).toContain("NGN");
    expect(pdf).toMatch(/100[,.]?000/); // net subtotal = total − VAT
    expect(pdf).toMatch(/7[,.]?500/);   // VAT line
  });

  const PO_LANDED = { id: "po-1", business_id: "biz-1", po_number: "PO-0007", supplier_id: null, status: "draft", expected_date: null, total_amount: 60000, notes: null, created_at: "2026-06-01T00:00:00Z", tax_amount: 0, landed_costs: [{ label: "Freight", amount: 6000 }] };
  const PO_LANDED_ITEM = { id: "li1", purchase_order_id: "po-1", product_id: "p1", raw_material_id: null, description: "Rice 25kg", quantity: 10, unit_cost: 6000, line_total: 60000 };

  test("captures landed costs on the New PO form", async ({ page }) => {
    await stubRows(page, "products", [RICE]);
    await stubRows(page, "raw_materials", []);
    await page.reload();
    await page.route("**/rest/v1/rpc/next_doc_number**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify("PO-0009") }));
    let poBody: any = null;
    await page.route("**/rest/v1/purchase_orders**", (r) => {
      if (r.request().method() === "POST") { poBody = r.request().postDataJSON(); return r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "po-9", po_number: "PO-0009" }) }); }
      return r.fallback();
    });
    await page.route("**/rest/v1/purchase_order_items**", (r) => r.request().method() === "POST" ? r.fulfill({ status: 201, contentType: "application/json", body: "[]" }) : r.fallback());

    await page.getByRole("button", { name: "New PO" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Rice 25kg" }).click(); // auto-fills unit cost 6000
    await dialog.getByLabel("Freight amount").fill("5000"); // Duty left blank → dropped
    await dialog.getByRole("button", { name: "Create PO" }).click();
    await expect(page.getByText(/Purchase order PO-0009 created/)).toBeVisible();
    expect(poBody.landed_costs).toEqual([{ label: "Freight", amount: 5000 }]);
  });

  test("View shows the landed-cost breakdown and effective cost per unit", async ({ page }) => {
    await stubRows(page, "purchase_orders", [PO_LANDED]);
    await stubRows(page, "purchase_order_items", [PO_LANDED_ITEM]);
    await page.reload();
    await page.locator("table").getByRole("button", { name: "View" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Landed costs")).toBeVisible();
    await expect(dialog.getByText(/Landed cost total/)).toBeVisible();
    await expect(dialog.getByText(/66,?000/)).toBeVisible();  // 60,000 goods + 6,000 landed
    await expect(dialog.getByText(/6,?600/)).toBeVisible();   // 6,000 → 6,600 landed unit cost
  });

  test("Receiving a PO opens the landed-cost dialog and sends the final costs", async ({ page }) => {
    await stubRows(page, "purchase_orders", [PO_LANDED]);
    await stubRows(page, "purchase_order_items", [PO_LANDED_ITEM]);
    await page.reload();
    let patchBody: any = null;
    await page.route("**/rest/v1/purchase_orders**", (r) => {
      if (r.request().method() === "PATCH") { patchBody = r.request().postDataJSON(); return r.fulfill({ status: 200, contentType: "application/json", body: "[]" }); }
      return r.fallback();
    });
    await page.locator("table").getByRole("combobox").first().click(); // the row's status control
    await page.getByRole("option", { name: "Received" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Receive PO-0007")).toBeVisible();
    await dialog.getByRole("button", { name: "Receive & value stock" }).click();
    await expect(page.getByText(/PO received/)).toBeVisible();
    expect(patchBody.status).toBe("received");
    expect(patchBody.landed_costs).toEqual([{ label: "Freight", amount: 6000 }]);
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

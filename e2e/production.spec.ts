import { test, expect, type Page } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const FLOUR = { id: "m1", business_id: "biz-1", name: "Cassava Flour", sku: "CF-01", unit: "kg", stock_quantity: 50, reorder_level: 10, cost_per_unit: 1200, supplier_id: null, notes: null, created_at: "2026-06-01T00:00:00Z" };
const SUGAR = { id: "m2", business_id: "biz-1", name: "Sugar", sku: "SG-01", unit: "kg", stock_quantity: 5, reorder_level: 2, cost_per_unit: 800, supplier_id: null, notes: null, created_at: "2026-06-01T00:00:00Z" };
const GARRI = { id: "p1", business_id: "biz-1", name: "Garri 50kg", category: "Foodstuff", sku: "GAR-50", unit: "bag", selling_price: 8500, cost_price: 6000, stock_quantity: 20, reorder_level: 5, created_at: "2026-06-01T00:00:00Z" };

const RECIPE_ROW = {
  id: "pm1", product_id: "p1", raw_material_id: "m1", quantity_per_unit: 2.5,
  products: { name: "Garri 50kg", unit: "bag" }, raw_materials: { name: "Cassava Flour", unit: "kg" },
};

const PENDING_REQ = {
  id: "rq1", business_id: "biz-1", requested_by: "user-1", status: "pending", notes: "Saturday batch",
  decision_note: null, approved_by: null, approved_at: null, created_at: "2026-07-06T00:00:00Z",
  production_requisition_items: [
    { id: "ri1", raw_material_id: "m1", quantity_requested: 10, quantity_issued: null, raw_materials: { name: "Cassava Flour", unit: "kg" } },
  ],
};
const APPROVED_REQ = {
  ...PENDING_REQ, id: "rq2", status: "approved", approved_by: "user-1", approved_at: "2026-07-06T01:00:00Z",
  production_requisition_items: [
    { id: "ri2", raw_material_id: "m1", quantity_requested: 10, quantity_issued: 10, raw_materials: { name: "Cassava Flour", unit: "kg" } },
  ],
};

function stubProduction(page: Page, opts: { recipes?: object[]; reqs?: object[]; runs?: object[] } = {}) {
  return Promise.all([
    stubRows(page, "product_materials", opts.recipes ?? []),
    stubRows(page, "production_requisitions", opts.reqs ?? []),
    stubRows(page, "production_runs", opts.runs ?? []),
    stubRows(page, "raw_materials", [FLOUR, SUGAR]),
    stubRows(page, "products", [GARRI]),
  ]);
}

test.describe("Production", () => {
  test("owner sees the module, its tabs, and existing recipes", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await expect(page.getByRole("link", { name: "Production" })).toBeVisible();
    await stubProduction(page, { recipes: [RECIPE_ROW] });
    await page.goto("/production");
    await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
    for (const t of ["Recipes", "Requests", "Runs"]) await expect(page.getByRole("button", { name: t, exact: true })).toBeVisible();
    await expect(page.getByRole("table").getByText("Garri 50kg")).toBeVisible();
    await expect(page.getByRole("table").getByText(/Cassava Flour × 2.5 kg/)).toBeVisible();
  });

  test("recipe editor saves the material lines to product_materials", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubProduction(page);
    const writes: any[] = [];
    await page.route("**/rest/v1/product_materials**", (r) => {
      const method = r.request().method();
      if (method === "POST") { writes.push(r.request().postDataJSON()); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
      if (method === "DELETE") return r.fulfill({ status: 204, body: "" });
      return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.goto("/production");
    await page.getByRole("button", { name: "Add recipe" }).first().click(); // header + empty-state CTA both match
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Garri 50kg" }).click();
    await page.getByRole("combobox").nth(1).click();
    await page.getByRole("option", { name: "Cassava Flour" }).click();
    await page.getByLabel("Quantity of material 1").fill("2.5");
    await page.getByRole("button", { name: "Save recipe" }).click();
    await expect(page.getByText("Recipe saved")).toBeVisible();
    expect(writes).toEqual([[{ product_id: "p1", raw_material_id: "m1", quantity_per_unit: 2.5 }]]);
  });

  test("request materials sends the create_requisition RPC payload", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubProduction(page);
    let payload: any = null;
    await page.route("**/rest/v1/rpc/create_requisition**", (r) => {
      payload = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "rq9", status: "pending", items: 1 }) });
    });
    await page.goto("/production?tab=requests");
    await page.getByRole("button", { name: "Request materials" }).first().click(); // header + empty-state CTA both match
    await page.getByRole("dialog").getByRole("combobox").click();
    await page.getByRole("option", { name: "Cassava Flour" }).click();
    await page.getByLabel("Material quantity 1").fill("10");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Materials request sent for approval")).toBeVisible();
    expect(payload).toEqual({ _business_id: "biz-1", _items: [{ raw_material_id: "m1", quantity: 10 }], _notes: null });
  });

  test("the Production requests tab has no approve/reject (that leg lives on Raw Materials)", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubProduction(page, { reqs: [PENDING_REQ] });
    await page.goto("/production?tab=requests");
    await expect(page.getByRole("table").getByText("Pending")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
  });

  test("completed requests show the trail of raw materials used in production", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    const COMPLETED_REQ = {
      ...APPROVED_REQ, id: "rq3", status: "completed",
      production_requisition_items: [
        { id: "ri3", raw_material_id: "m1", quantity_requested: 10, quantity_issued: 8, raw_materials: { name: "Cassava Flour", unit: "kg" } },
      ],
    };
    const RUN = {
      id: "run1", business_id: "biz-1", requisition_id: "rq3", produced_by: "user-1", notes: null, created_at: "2026-07-06T02:00:00Z",
      production_run_outputs: [{ product_id: "p1", quantity: 3, products: { name: "Garri 50kg", unit: "bag" } }],
      production_run_materials: [{ raw_material_id: "m1", quantity_used: 7, raw_materials: { name: "Cassava Flour", unit: "kg" } }],
    };
    await stubProduction(page, { reqs: [COMPLETED_REQ], runs: [RUN] });
    await page.goto("/production?tab=requests");
    // Issued (reduced at approval) + used-in-production trails, scoped to the desktop table.
    await expect(page.getByRole("table").getByText("Issued: Cassava Flour × 8")).toBeVisible();
    await expect(page.getByRole("table").getByText("Used in production: Cassava Flour × 7 kg")).toBeVisible();
  });

  test("record production from an approved request prefills materials and sends the run RPC", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubProduction(page, { reqs: [APPROVED_REQ] });
    let runPayload: any = null;
    await page.route("**/rest/v1/rpc/record_production_run**", (r) => {
      runPayload = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "run9" }) });
    });
    await page.goto("/production?tab=requests");
    await page.getByRole("button", { name: "Produce" }).first().click();

    // Materials prefilled from the requisition's issued quantities.
    await expect(page.getByLabel("Material quantity 1")).toHaveValue("10");

    await page.getByRole("dialog").getByRole("combobox").nth(1).click(); // first = requisition select, second = product line
    await page.getByRole("option", { name: "Garri 50kg" }).click();
    await page.getByLabel("Product quantity 1").fill("4");
    await page.getByLabel("Material quantity 1").fill("8"); // used less than issued
    await page.getByRole("button", { name: "Record production", exact: true }).click();
    await expect(page.getByText("Production recorded — product stock updated")).toBeVisible();
    expect(runPayload).toEqual({
      _business_id: "biz-1",
      _requisition_id: "rq2",
      _outputs: [{ product_id: "p1", quantity: 4 }],
      _materials: [{ raw_material_id: "m1", quantity_used: 8 }],
      _notes: null,
    });
  });

  test("requester can edit and delete their own pending request", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    // Requested by the signed-in user (FAKE_USER.id). Production has no approval leg now, so
    // Edit/Delete are direct row actions.
    const OWN_REQ = { ...PENDING_REQ, id: "rq5", requested_by: "00000000-0000-0000-0000-000000000001" };
    await stubProduction(page, { reqs: [OWN_REQ] });
    let updatePayload: any = null;
    let deleteCalled = false;
    await page.route("**/rest/v1/rpc/update_requisition**", (r) => {
      updatePayload = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "rq5", status: "pending" }) });
    });
    await page.route("**/rest/v1/rpc/delete_requisition**", (r) => {
      deleteCalled = true;
      return r.fulfill({ status: 200, contentType: "application/json", body: "null" });
    });
    await page.goto("/production?tab=requests");

    // Edit: prefilled with the requested quantity, change it, save.
    await page.getByRole("table").getByRole("button", { name: "Edit" }).click();
    await expect(page.getByLabel("Material quantity 1")).toHaveValue("10");
    await page.getByLabel("Material quantity 1").fill("12");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Request updated")).toBeVisible();
    expect(updatePayload).toEqual({ _requisition_id: "rq5", _items: [{ raw_material_id: "m1", quantity: 12 }], _notes: "Saturday batch" });

    // Delete: confirm dialog → RPC.
    await page.getByRole("table").getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Delete request", exact: true }).click();
    await expect(page.getByText("Request deleted")).toBeVisible();
    expect(deleteCalled).toBe(true);
  });

  test("cashier has no nav link and hits No access on the direct URL", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await expect(page.getByRole("link", { name: "Production" })).toHaveCount(0);
    await page.goto("/production");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});

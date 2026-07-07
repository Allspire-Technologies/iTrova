import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const material = {
  id: "rm-1",
  business_id: "biz-1",
  name: "Cassava flour",
  sku: "CAS-1",
  unit: "kg",
  stock_quantity: 100,
  reorder_level: 10,
  cost_per_unit: 500,
  supplier_id: null,
  notes: null,
  created_at: "2026-06-01T00:00:00Z",
};

test.describe("Raw Materials", () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "raw_materials", [material]);
    await page.goto("/raw-materials");
  });

  test("lists materials", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Raw Materials" })).toBeVisible();
    // Scope to the desktop table — the responsive layout also renders a (hidden) mobile card.
    await expect(page.locator("table").getByText("Cassava flour")).toBeVisible();
  });

  test("More menu links a material to a product via the recipe editor", async ({ page }) => {
    await stubRows(page, "products", [{ id: "p1", business_id: "biz-1", name: "Garri 50kg", unit: "bag" }]);
    await stubRows(page, "product_materials", []);
    await page.getByRole("button", { name: "More actions for Cassava flour", exact: true }).last().click(); // desktop copy
    await page.getByRole("menuitem", { name: "Link to product" }).click();
    // Editor opens seeded with this material on the first line.
    await expect(page.getByRole("dialog").getByText("Link materials to a product")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Cassava flour")).toBeVisible();
  });

  test("Requests tab approves a production material request with a reduced quantity", async ({ page }) => {
    const PENDING_REQ = {
      id: "rq1", business_id: "biz-1", requested_by: "user-9", status: "pending", notes: "Saturday batch",
      decision_note: null, approved_by: null, approved_at: null, created_at: "2026-07-06T00:00:00Z",
      production_requisition_items: [
        { id: "ri1", raw_material_id: "rm-1", quantity_requested: 40, quantity_issued: null, raw_materials: { name: "Cassava flour", unit: "kg" } },
      ],
    };
    await stubRows(page, "production_requisitions", [PENDING_REQ]);
    let approvePayload: any = null;
    await page.route("**/rest/v1/rpc/approve_requisition**", (r) => {
      approvePayload = r.request().postDataJSON();
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "rq1", status: "approved" }) });
    });
    // The approval leg lives on Raw Materials so a stock custodian (no Production module) can act.
    await page.getByRole("tab", { name: /Requests/ }).click();
    await expect(page.getByRole("table").getByText("Pending")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.getByText("Approve and issue materials")).toBeVisible();
    await expect(page.getByLabel("Approve quantity 1")).toHaveValue("40");
    await page.getByLabel("Approve quantity 1").fill("25"); // reduce before issuing
    await page.getByRole("button", { name: "Approve & issue" }).click();
    await expect(page.getByText("Approved — materials issued")).toBeVisible();
    expect(approvePayload).toEqual({ _requisition_id: "rq1", _items: [{ raw_material_id: "rm-1", quantity: 25 }] });
  });

  test("shows the materials and deliveries tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /Materials/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Deliveries/ })).toBeVisible();
  });

  test("CSV import tolerates currency/commas, restocks by SKU and rejects unknown suppliers", async ({ page }) => {
    const csv = [
      "Name,SKU,Stock Quantity,Cost Per Unit,Supplier",
      'New Mat,NM-1,"1,500","₦1,200",',   // commas + currency parse fine -> insert
      "Restock,cas-1,50,600,",            // matches existing CAS-1 (case-insensitive) -> restock
      "Ghost Mat,GM-1,5,10,Ghost Ltd",    // supplier doesn't exist -> rejected with a reason
    ].join("\n");
    await page.locator('input[type="file"]').setInputFiles({ name: "materials.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(page.getByRole("heading", { name: "Import results" })).toBeVisible();
    await expect(page.getByText(/2 rows imported · 1 added · 1 restocked/)).toBeVisible();
    await expect(page.getByText(/1 row not imported/)).toBeVisible();
    await expect(page.getByText(/Supplier "Ghost Ltd" not found/)).toBeVisible();
  });
});

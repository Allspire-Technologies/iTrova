import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

test.describe("Purchase Orders", () => {
  test.beforeEach(async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/purchase-orders");
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

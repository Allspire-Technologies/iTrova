import { test, expect, type Page } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const product = {
  id: "prod-1",
  business_id: "biz-1",
  name: "Garri 50kg",
  category: "Foodstuff",
  sku: "GAR-50",
  unit: "bag",
  selling_price: 8500,
  cost_price: 6000,
  stock_quantity: 20,
  reorder_level: 5,
  created_at: "2026-06-01T00:00:00Z",
};

const order = {
  id: "ord-1",
  business_id: "biz-1",
  customer_name: "Adaeze O.",
  customer_phone: "+234 800 000 0001",
  channel: "online",
  payment_method: "cash",
  status: "pending",
  notes: null,
  total_amount: 8500,
  stock_deducted: false,
  created_at: "2026-06-20T00:00:00Z",
  order_items: [{ id: "oi-1", product_id: "prod-1", quantity: 1, unit_price: 8500 }],
};

async function openOrders(page: Page, role: "owner" | "manager" | "cashier") {
  await authenticate(page, { role });
  await stubRows(page, "products", [product]);
  await stubRows(page, "orders", [order]);
  await page.goto("/pos");
  await page.getByRole("tab", { name: "Orders" }).click();
  await expect(page.getByText("Adaeze O.")).toBeVisible();
}

test.describe("POS orders", () => {
  test("cashier cannot delete an order", async ({ page }) => {
    await openOrders(page, "cashier");
    await expect(page.getByRole("button", { name: "Delete order" })).toHaveCount(0);
  });

  test("owner can delete an order", async ({ page }) => {
    await openOrders(page, "owner");
    await expect(page.getByRole("button", { name: "Delete order" })).toBeVisible();
  });

  test("cashier can edit a pending order", async ({ page }) => {
    await openOrders(page, "cashier");
    await page.getByRole("button", { name: "Edit order" }).click();
    await expect(page.getByText("Edit order")).toBeVisible();
    await expect(page.getByPlaceholder("e.g. Adaeze O.")).toHaveValue("Adaeze O.");
  });

  test("owner can edit a pending order", async ({ page }) => {
    await openOrders(page, "owner");
    await page.getByRole("button", { name: "Edit order" }).click();
    await expect(page.getByText("Edit order")).toBeVisible();
    await expect(page.getByPlaceholder("e.g. Adaeze O.")).toHaveValue("Adaeze O.");
  });

  test("a discount on a new order nets off the total", async ({ page }) => {
    await openOrders(page, "owner");
    await page.getByRole("button", { name: "New order" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Pick a product...").click();
    await page.getByRole("option", { name: /Garri 50kg/ }).click(); // subtotal 8,500
    await dialog.locator("#order-discount").fill("500");
    await expect(dialog.getByText(/Subtotal/)).toBeVisible();
    await expect(dialog.getByText(/-\D*500/)).toBeVisible();
    await expect(dialog.getByText(/8,000/)).toBeVisible(); // net total
  });

  test("delivering an order books a paid invoice and links it", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "products", [product]);
    // A shipped order (stock already deducted) so delivery only has to create the invoice.
    const state = { order: { ...order, status: "shipped", stock_deducted: true } as Record<string, unknown> };
    await page.route("**/rest/v1/orders**", (r) =>
      r.request().method() === "GET"
        ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([state.order]) })
        : r.fallback());
    await page.route("**/rest/v1/rpc/deliver_order**", (r) => {
      state.order = { ...state.order, status: "delivered", invoice_id: "inv-x", invoice: { invoice_number: "260701-1" } };
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "committed", invoice_number: "260701-1" }) });
    });
    await page.goto("/pos");
    await page.getByRole("tab", { name: "Orders" }).click();
    await expect(page.getByText("Adaeze O.")).toBeVisible();

    // Move the order to Delivered via its status dropdown, then confirm.
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Delivered" }).click();
    await page.getByRole("button", { name: "Mark delivered" }).click();

    // The RPC created the invoice; the card now shows a link to it.
    await expect(page.getByRole("link", { name: /260701-1/ })).toBeVisible();
  });
});

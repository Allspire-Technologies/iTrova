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
});

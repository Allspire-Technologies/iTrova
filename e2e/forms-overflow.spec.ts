import { test, expect, type Page } from "@playwright/test";

// Regression guard: no form dialog may scroll horizontally at phone width (390px).
import { authenticate, stubRows } from "./support/auth";

async function checkNoHOverflow(page: Page, name: string) {
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.waitForTimeout(350);
  const m = await dialog.evaluate((el) => {
    let worst = 0, worstEl = "";
    const walk = (n: Element) => {
      const r = n.getBoundingClientRect();
      if (r.right - window.innerWidth > worst) { worst = r.right - window.innerWidth; worstEl = `${n.tagName}.${(n as HTMLElement).className?.toString().slice(0, 60)}`; }
      for (const c of n.children) walk(c);
    };
    walk(el);
    return { h: el.scrollWidth - el.clientWidth, worst: Math.round(worst), worstEl };
  });
  expect(m.h, `${name} has horizontal scroll inside the dialog`).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
}

test("form dialogs have no horizontal overflow at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await authenticate(page, { role: "owner" });
  await stubRows(page, "products", [{ id: "p1", business_id: "biz-1", name: "Garri Premium Extra Long Name 50kg", category: "Food", sku: "GAR-50", unit: "bag", selling_price: 8500, cost_price: 6000, stock_quantity: 20, reorder_level: 5, created_at: "2026-06-01" }]);

  await page.goto("/inventory");
  await page.getByRole("button", { name: "Add product" }).first().click();
  await checkNoHOverflow(page, "inventory-add");
  await page.getByRole("button", { name: "Adjust" }).first().click();
  await checkNoHOverflow(page, "stock-adjust");

  await stubRows(page, "suppliers", [{ id: "s1", business_id: "biz-1", name: "Golden Farms", contact_name: null, phone: null, email: null, rating: 4, last_order_date: null, created_at: "2026-06-01" }]);
  await page.goto("/suppliers");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await checkNoHOverflow(page, "suppliers-add");

  await page.goto("/raw-materials");
  await page.getByRole("button", { name: "Add material" }).first().click();
  await checkNoHOverflow(page, "raw-materials-add");

  await stubRows(page, "invoices", []);
  await page.goto("/invoices");
  await page.getByRole("button", { name: "New invoice" }).first().click();
  await checkNoHOverflow(page, "invoices-new");

  await stubRows(page, "orders", []);
  await page.goto("/pos");
  await page.getByRole("tab", { name: "Orders" }).click();
  await page.getByRole("button", { name: "New order" }).click();
  await checkNoHOverflow(page, "order-create");

  await stubRows(page, "store_items", []); await stubRows(page, "store_staff", []); await stubRows(page, "store_transactions", []);
  await page.goto("/general-store");
  await page.getByRole("button", { name: "Give out" }).click();
  await checkNoHOverflow(page, "gs-giveout");
  await page.getByRole("button", { name: "Add item" }).first().click();
  await checkNoHOverflow(page, "gs-item-add");

  await page.goto("/team");
  await page.getByRole("button", { name: "Invite teammate" }).click();
  await checkNoHOverflow(page, "team-invite");

  await stubRows(page, "team_roles", []);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Permissions & Access" }).click();
  await page.getByRole("button", { name: "New role" }).click();
  await checkNoHOverflow(page, "role-editor");
});

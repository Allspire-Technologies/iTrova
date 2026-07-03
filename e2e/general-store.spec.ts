import { test, expect, type Page } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const DRILL = { id: "i1", business_id: "biz-1", name: "Cordless Drill", category: "Tools", unit: "pcs", kind: "borrowable", stock_quantity: 3, reorder_level: 1, created_at: "2026-06-01T00:00:00Z" };
const SCREWS = { id: "i2", business_id: "biz-1", name: "Wood Screws", category: "Fasteners", unit: "box", kind: "consumable", stock_quantity: 500, reorder_level: 50, created_at: "2026-06-01T00:00:00Z" };
const STAFFER = { id: "s1", business_id: "biz-1", name: "Ayo Bello", phone: "080", role: "Operator", active: true, created_at: "2026-06-01T00:00:00Z" };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const BORROW_TXN = {
  id: "t1", business_id: "biz-1", item_id: "i1", staff_id: "s1", kind: "borrow", quantity: 2, returned_quantity: 0,
  status: "out", due_date: daysAgo(3), returned_at: null, notes: null, created_at: `${daysAgo(5)}T00:00:00Z`,
  item: { name: "Cordless Drill", unit: "pcs", kind: "borrowable" }, staff: { name: "Ayo Bello" },
};

function stubStore(page: Page, opts: { items?: object[]; staff?: object[]; txns?: object[] } = {}) {
  return Promise.all([
    stubRows(page, "store_items", opts.items ?? []),
    stubRows(page, "store_staff", opts.staff ?? []),
    stubRows(page, "store_transactions", opts.txns ?? []),
  ]);
}

test.describe("General Store", () => {
  test("owner sees the module and its tabs", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await expect(page.getByRole("link", { name: "General Store" })).toBeVisible();
    await stubStore(page);
    await page.goto("/general-store");
    await expect(page.getByRole("heading", { name: "General Store" })).toBeVisible();
    for (const t of ["Items", "Staff", "Records"]) await expect(page.getByRole("button", { name: t })).toBeVisible();
  });

  test("give-out dialog filters items by action, and records a borrow", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubStore(page, { items: [DRILL, SCREWS], staff: [STAFFER] });
    let called: unknown = null;
    await page.route("**/rest/v1/rpc/store_checkout**", (r) => { called = r.request().postDataJSON(); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "t9", status: "out" }) }); });
    await page.goto("/general-store");
    await page.getByRole("button", { name: "Give out" }).click();

    // Borrow action → only borrowable items are offered.
    const itemSelect = page.getByLabel("Item", { exact: true });
    await expect(itemSelect.locator("option", { hasText: "Cordless Drill" })).toHaveCount(1);
    await expect(itemSelect.locator("option", { hasText: "Wood Screws" })).toHaveCount(0);
    // Switch to collect → only consumables.
    await page.getByLabel("Action").selectOption("collect");
    await expect(itemSelect.locator("option", { hasText: "Wood Screws" })).toHaveCount(1);
    await expect(itemSelect.locator("option", { hasText: "Cordless Drill" })).toHaveCount(0);

    // Complete a borrow.
    await page.getByLabel("Action").selectOption("borrow");
    await itemSelect.selectOption("i1");
    await page.getByLabel("Staff").selectOption("s1");
    await page.getByLabel("Quantity").fill("1");
    await page.getByRole("button", { name: "Give out" }).click();
    await expect(page.getByText("Item given out")).toBeVisible();
    expect(called).toMatchObject({ _kind: "borrow", _item_id: "i1", _staff_id: "s1", _quantity: 1 });
  });

  test("records show outstanding, an overdue badge, and a Return action", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubStore(page, { items: [DRILL], staff: [STAFFER], txns: [BORROW_TXN] });
    await page.goto("/general-store");
    await page.getByRole("button", { name: "Records" }).click();
    await expect(page.getByRole("cell", { name: "Cordless Drill" })).toBeVisible();
    await expect(page.getByText("Overdue")).toBeVisible();
    await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
  });

  test("a manager cannot delete items", async ({ page }) => {
    await authenticate(page, { role: "manager" });
    await stubStore(page, { items: [DRILL] });
    await page.goto("/general-store");
    await expect(page.getByRole("cell", { name: "Cordless Drill · Tools" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Cordless Drill" })).toHaveCount(0);
  });

  test("a cashier cannot reach the module", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await expect(page.getByRole("link", { name: "General Store" })).toHaveCount(0);
  });
});

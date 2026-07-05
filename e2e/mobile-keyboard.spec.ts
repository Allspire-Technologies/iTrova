import { test, expect, type Page } from "@playwright/test";

// Regression guard: every form dialog must fit and scroll at a keyboard-shrunk viewport, so the
// focused input/submit can always be brought into view when the phone's soft keyboard opens.
// (Fix: DialogContent max-h-[calc(100dvh-2rem)] + overflow-y-auto; viewport meta interactive-widget.)
import { authenticate, stubRows } from "./support/auth";
const KBD = { width: 390, height: 450 }; // phone with soft keyboard open

async function checkDialog(page: Page, name: string, submitName: string | RegExp) {
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const box = await dialog.boundingBox();
  const fits = !!box && box.height <= KBD.height;
  // The submit button must be reachable by scrolling within the dialog.
  const btn = dialog.getByRole("button", { name: submitName }).last();
  await btn.scrollIntoViewIfNeeded();
  const visible = await btn.isVisible();
  expect(fits, `${name} dialog taller than keyboard viewport`).toBe(true);
  expect(visible, `${name} submit unreachable`).toBe(true);
  await page.keyboard.press("Escape");
}

test("tall dialogs fit and scroll at keyboard-height viewport", async ({ page }) => {
  await page.setViewportSize(KBD);
  await authenticate(page, { role: "owner" });

  // Inventory — Add product (long form)
  await stubRows(page, "products", []);
  await page.goto("/inventory");
  await page.getByRole("button", { name: "Add product" }).first().click();
  await checkDialog(page, "inventory-add", /Add product|Save/);

  // General Store — Give out
  await stubRows(page, "store_items", [{ id: "i1", business_id: "biz-1", name: "Drill", category: null, unit: "pcs", kind: "borrowable", stock_quantity: 3, reorder_level: 1, created_at: "2026-06-01" }]);
  await stubRows(page, "store_staff", [{ id: "s1", business_id: "biz-1", name: "Ayo", phone: null, role: null, active: true, created_at: "2026-06-01" }]);
  await stubRows(page, "store_transactions", []);
  await page.goto("/general-store");
  await page.getByRole("button", { name: "Give out" }).click();
  await checkDialog(page, "gs-giveout", /Give out|Record collection/);

  // Team — Invite
  await page.goto("/team");
  await page.getByRole("button", { name: "Invite teammate" }).click();
  await checkDialog(page, "team-invite", "Create invite");

  // Invoices — New invoice (longest form in the app)
  await stubRows(page, "invoices", []);
  await page.goto("/invoices");
  await page.getByRole("button", { name: "New invoice" }).click();
  await checkDialog(page, "invoices-new", /Create invoice|Save/);

  // Settings — Permissions role editor (has its own inner scroll)
  await stubRows(page, "team_roles", []);
  await page.goto("/settings");
  await page.getByRole("button", { name: "Permissions & Access" }).click();
  await page.getByRole("button", { name: "New role" }).click();
  await checkDialog(page, "settings-role-editor", "Save role");
});

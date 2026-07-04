import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

// RBAC v1. The auth helper's catch-all (**/rest/v1/** → []) answers member_access/team_roles with
// empty arrays, so every OTHER spec exercises the code-default path (today's behavior).

test.describe("Permissions & Access", () => {
  test("owner sees the tab with locked Owner + default roles, and can create a custom role", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    let posted: Record<string, unknown> | null = null;
    await page.route("**/rest/v1/team_roles**", (r) => {
      if (r.request().method() === "POST") { posted = r.request().postDataJSON(); return r.fulfill({ status: 201, contentType: "application/json", body: "[]" }); }
      return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: "Permissions & Access" }).click();
    await expect(page.getByText("Owner", { exact: true })).toBeVisible();
    await expect(page.getByText("Full access to everything — can't be changed.")).toBeVisible();
    await expect(page.getByText("Manager").first()).toBeVisible();
    await expect(page.getByText("Cashier").first()).toBeVisible();

    // Create a custom role granting only General Store view+checkout.
    await page.getByRole("button", { name: "New role" }).click();
    await page.getByPlaceholder("e.g. Storekeeper").fill("Storekeeper");
    await page.getByLabel("General Store module").check();          // grants all GS actions
    await page.getByLabel("General Store: Delete items").uncheck(); // then trim one
    await page.getByRole("button", { name: "Save role" }).click();
    await expect(page.getByText("Role saved")).toBeVisible();
    expect(posted).toMatchObject({ name: "Storekeeper" });
    const perms = (posted as { permissions?: Record<string, string[]> })?.permissions;
    expect(perms?.general_store).toContain("view");
    expect(perms?.general_store).not.toContain("item_delete");
  });

  test("a restricted member loses nav items and hits No access on direct URLs", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await stubRows(page, "member_access", [{ user_id: "00000000-0000-0000-0000-000000000001", business_id: "biz-1", team_role_id: null, permissions: { pos: ["view"] } }]);
    await page.goto("/");
    // Only POS remains of the permission modules; Invoices (cashier default) is gone.
    await expect(page.getByRole("link", { name: "Point of Sale" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Invoices" })).toHaveCount(0);
    await page.goto("/invoices");
    await expect(page.getByText("No access")).toBeVisible();
  });

  test("a granted cashier gains a module beyond their defaults", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await stubRows(page, "member_access", [{ user_id: "00000000-0000-0000-0000-000000000001", business_id: "biz-1", team_role_id: null, permissions: { pos: ["view", "orders_manage"], invoices: ["view", "create"], inventory: ["view"] } }]);
    await stubRows(page, "products", []);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Inventory" })).toBeVisible();
    await page.getByRole("link", { name: "Inventory" }).click();
    await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  });

  test("defaults regression: manager keeps invoice actions, cashier keeps POS-only nav", async ({ page }) => {
    // No RBAC rows stubbed → code defaults (pre-RBAC behavior).
    await authenticate(page, { role: "manager" });
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Inventory" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Team" })).toHaveCount(0); // team stays owner-only by default
  });

  test("cashier has no Permissions tab", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Preferences" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Permissions & Access" })).toHaveCount(0);
  });
});

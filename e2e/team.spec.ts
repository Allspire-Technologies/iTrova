import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";
import { FAKE_USER } from "./support/supabase";

test.describe("Team", () => {
  test("owner can manage the team", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Invite teammate/ })).toBeVisible();
  });

  test("owner removes a staff member via the remove_member RPC", async ({ page }) => {
    await authenticate(page, {
      role: "owner",
      onRoutes: async (p) => {
        await p.route("**/rest/v1/user_roles**", (r) => {
          // AuthContext filters by user_id (resolve my role); the Team list filters by business only.
          const rows = r.request().url().includes("user_id=")
            ? [{ user_id: FAKE_USER.id, role: "owner" }]
            : [{ user_id: FAKE_USER.id, role: "owner" }, { user_id: "staff-1", role: "cashier" }];
          return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
        });
        await p.route("**/rest/v1/profiles**", (r) => {
          const owner = { id: FAKE_USER.id, owner_name: "Ada Obi", business_id: "biz-1", onboarded: true, last_seen: null };
          // The Team list uses .in("id", …) (array); AuthContext uses .eq("id", …).maybeSingle() (object).
          const body = r.request().url().includes("id=in.")
            ? JSON.stringify([owner, { id: "staff-1", owner_name: "Bola Staff", business_id: "biz-1", last_seen: null }])
            : JSON.stringify(owner);
          return r.fulfill({ status: 200, contentType: "application/json", body });
        });
        await p.route("**/rest/v1/rpc/get_member_emails**", (r) =>
          r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ user_id: "staff-1", email: "bola@biz.test" }]) }));
        await p.route("**/rest/v1/rpc/remove_member**", (r) =>
          r.fulfill({ status: 200, contentType: "application/json", body: "null" }));
      },
    });
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();
    await expect(page.getByText("Bola Staff")).toBeVisible();

    await page.getByRole("button", { name: "Remove member" }).click();
    await expect(page.getByText("Remove Bola Staff?")).toBeVisible();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Member removed")).toBeVisible();
  });

  test("non-owners are blocked", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });
});

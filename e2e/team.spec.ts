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

    await page.getByRole("button", { name: /More actions for Bola/ }).click();
    await page.getByRole("menuitem", { name: "Remove member" }).click();
    await expect(page.getByText("Remove Bola Staff?")).toBeVisible();
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Member removed")).toBeVisible();
  });

  test("role change uses set_member_role and shows custom role names", async ({ page }) => {
    await authenticate(page, {
      role: "owner",
      onRoutes: async (p) => {
        await p.route("**/rest/v1/user_roles**", (r) => {
          const rows = r.request().url().includes("user_id=")
            ? [{ user_id: FAKE_USER.id, role: "owner" }]
            : [{ user_id: FAKE_USER.id, role: "owner" }, { user_id: "staff-1", role: "cashier" }];
          return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
        });
        await p.route("**/rest/v1/profiles**", (r) => {
          const owner = { id: FAKE_USER.id, owner_name: "Ada Obi", business_id: "biz-1", onboarded: true, last_seen: null };
          const body = r.request().url().includes("id=in.")
            ? JSON.stringify([owner, { id: "staff-1", owner_name: "Bola Staff", business_id: "biz-1", last_seen: null }])
            : JSON.stringify(owner);
          return r.fulfill({ status: 200, contentType: "application/json", body });
        });
        await p.route("**/rest/v1/rpc/get_member_emails**", (r) =>
          r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ user_id: "staff-1", email: "bola@biz.test" }]) }));
        await p.route("**/rest/v1/team_roles**", (r) =>
          r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "tr-1", name: "Production Manager" }]) }));
        await p.route("**/rest/v1/member_access**", (r) =>
          r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ user_id: "staff-1", team_role_id: "tr-1" }]) }));
        await p.route("**/rest/v1/rpc/set_member_role**", (r) =>
          r.fulfill({ status: 200, contentType: "application/json", body: "null" }));
      },
    });
    await page.goto("/team");
    // The custom role's name shows instead of the base role.
    await expect(page.getByText("Production Manager").first()).toBeVisible();

    const rpc = page.waitForRequest((r) => r.url().includes("/rest/v1/rpc/set_member_role") && r.method() === "POST");
    await page.getByRole("combobox").filter({ hasText: "Production Manager" }).click();
    await page.getByRole("option", { name: "Manager", exact: true }).click();
    const req = await rpc;
    expect(req.postData() ?? "").toContain('"_role":"manager"');
    expect(req.postData() ?? "").toContain('"_team_role_id":null');
    await expect(page.getByText("Role updated to Manager")).toBeVisible();
  });

  test("non-owners are blocked", async ({ page }) => {
    await authenticate(page, { role: "cashier" });
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "No access" })).toBeVisible();
  });

  test("CSV import creates invitations and rejects bad emails/roles with reasons", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await page.goto("/team");
    await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

    const csv = [
      "Email,Role",
      "ada@new.co,cashier", // valid -> invitation created
      "bad-email,cashier",  // malformed address -> rejected
      "x@y.co,owner",       // owner isn't an invitable role -> rejected
    ].join("\n");
    await page.locator('input[type="file"]').setInputFiles({ name: "team.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });

    await expect(page.getByRole("heading", { name: "Import results" })).toBeVisible();
    await expect(page.getByText(/1 row imported · 1 invitation created/)).toBeVisible();
    await expect(page.getByText(/2 rows not imported/)).toBeVisible();
    await expect(page.getByText(/Invalid Email/)).toBeVisible();
    await expect(page.getByText(/Invalid Role — use manager or cashier/)).toBeVisible();
  });
});

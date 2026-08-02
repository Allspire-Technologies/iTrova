import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

// Onboarding plan picker: module + scale selection → plan recommendation → optional 7-day trial.
// The owner profile is stubbed onboarded:false so the dialog opens on the dashboard.

const FREE_PLAN = {
  id: "plan-free", key: "free", name: "Free", description: null,
  price_amount: 0, price_currency: "NGN", billing_period: "month",
  features: [], limits: {}, is_active: true, sort_order: 1, business_id: null,
  promo_percent: 0, promo_label: null, promo_until: null,
  modules: [], prices: [],
};
const PRO_PLAN = {
  ...FREE_PLAN,
  id: "plan-pro", key: "pro", name: "Pro", price_amount: 5000, sort_order: 2,
  modules: ["inventory", "pos", "suppliers", "raw_materials", "invoices", "purchase_orders", "reports", "team", "csv_import", "csv_export", "export_invoices"],
  limits: { inventory: 1000, team: 10, invoices: 2000 },
};

async function openOnboarding(page: import("@playwright/test").Page, onRoutes?: (p: import("@playwright/test").Page) => Promise<void>) {
  await authenticate(page, {
    onRoutes: async (p) => {
      await p.route("**/rest/v1/profiles**", (r) => {
        const accept = r.request().headers()["accept"] || "";
        const profile = {
          id: "user-1", owner_name: "Ada Obi", business_id: "biz-1", onboarded: false,
          phone: null, notification_prefs: null, last_seen: null, created_at: "2026-06-01T00:00:00Z",
        };
        return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(accept.includes("vnd.pgrst.object") ? profile : [profile]) });
      });
      await p.route("**/rest/v1/plans**", (r) =>
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([FREE_PLAN, PRO_PLAN]) }));
      if (onRoutes) await onRoutes(p);
    },
  });
  await expect(page.getByText("Welcome, Ada!")).toBeVisible();
}

test.describe("Onboarding plan picker", () => {
  test("free-tier selection ends on the Free-covers-you message (no trial offer)", async ({ page }) => {
    await openOnboarding(page);
    await page.getByRole("button", { name: "Continue" }).click();          // business details
    await page.getByRole("button", { name: /Point of Sale/ }).click();     // modules: POS only
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Up to 100", exact: true }).click(); // small scale
    await page.getByRole("button", { name: "Continue" }).click();          // saves onboarding_profile → final step
    await expect(page.getByText(/Free plan/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start 7-day free trial" })).toHaveCount(0);
  });

  test("paid-module selection recommends Pro, saves the profile, and starts the trial via RPC", async ({ page }) => {
    const rpcCalls: any[] = [];
    const bizPatches: any[] = [];
    await openOnboarding(page, async (p) => {
      await p.route("**/rest/v1/rpc/start_plan_trial**", (r) => {
        rpcCalls.push(r.request().postDataJSON());
        return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "started", plan: "pro" }) });
      });
      await p.route("**/rest/v1/businesses**", (r) => {
        if (r.request().method() === "PATCH") bizPatches.push(r.request().postDataJSON());
        const business = {
          id: "biz-1", name: "Sunrise Stores", owner_id: "user-1", currency: "NGN", timezone: "Africa/Lagos",
          subscription_tier: "free", whatsapp_number: null, trial_plan: null, trial_started_at: null,
          created_at: "2026-06-01T00:00:00Z",
        };
        const accept = r.request().headers()["accept"] || "";
        return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(accept.includes("vnd.pgrst.object") ? business : [business]) });
      });
    });

    await page.getByRole("button", { name: "Continue" }).click();            // business details
    await page.getByRole("button", { name: /Export Invoices/ }).click();     // paid module → Pro
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Up to 1,000", exact: true }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Recommended for you")).toBeVisible();

    // The module/scale selection is persisted on the business for follow-up. Asserted after the
    // wizard advances (the PATCH resolves before the step changes), not mid-flight.
    const profilePatch = bizPatches.find(b => b?.onboarding_profile);
    expect(profilePatch.onboarding_profile.modules).toEqual(["export_invoices"]);
    expect(profilePatch.onboarding_profile.scale).toMatchObject({ products: "m" });
    await expect(page.getByText("Pro", { exact: true })).toBeVisible();
    // All three paths are on offer: trial, pay now, stay free.
    await expect(page.getByRole("button", { name: /^Upgrade now — pay / })).toBeVisible();
    await expect(page.getByRole("button", { name: "Use iTrova for Free for now" })).toBeVisible();
    await page.getByRole("button", { name: "Start 7-day free trial" }).click();
    await expect(page.getByText(/Trial active/)).toBeVisible();
    expect(rpcCalls).toEqual([{ _plan_key: "pro" }]);

    await page.getByRole("button", { name: "Start using iTrova" }).click();
    await expect(page.getByText("You're all set!")).toBeVisible();
  });

  test("Back returns to the previous step with the selection intact", async ({ page }) => {
    await openOnboarding(page);
    await page.getByRole("button", { name: "Continue" }).click();          // → modules
    await page.getByRole("button", { name: /Point of Sale/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();          // → scale
    await expect(page.getByText("How big is your operation?")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();              // ← modules
    await expect(page.getByText("What will you use?")).toBeVisible();
    await expect(page.getByRole("button", { name: /Point of Sale/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Back" }).click();              // ← business details
    await expect(page.getByText("Welcome, Ada!")).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toHaveCount(0); // no Back on step 1
  });

  test("closing the modal asks for confirmation; cancelling stays in setup", async ({ page }) => {
    await openOnboarding(page);
    await page.keyboard.press("Escape");
    await expect(page.getByText("Leave setup?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Leave setup?")).toBeHidden();
    await expect(page.getByText("Welcome, Ada!")).toBeVisible();   // still in the wizard

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Skip setup" }).click();
    await expect(page.getByText(/Setup skipped/)).toBeVisible();
  });
});

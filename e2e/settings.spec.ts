import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const base = { price_currency: "NGN", is_active: true, business_id: null, promo_percent: 0, promo_label: null, promo_until: null };
const plans = [
  { ...base, id: "pl-1", key: "free", name: "Free", description: "Small shops", price_amount: 0, billing_period: null, features: ["Inventory management", "POS & sales"], limits: { products: 100 }, sort_order: 1,
    prices: [{ id: "pp-1", cycle: "monthly", price_amount: 0, discount_percent: 0, is_active: true, sort_order: 1 }] },
  { ...base, id: "pl-2", key: "pro", name: "Pro", description: "Growing", price_amount: 5000, billing_period: "month", features: ["Everything in Free", "AI Insights"], limits: { products: null }, sort_order: 2,
    promo_percent: 10, promo_label: "Launch offer", promo_until: "2999-01-01T00:00:00Z",
    prices: [
      { id: "pp-2", cycle: "monthly", price_amount: 5000, discount_percent: 0, is_active: true, sort_order: 1 },
      { id: "pp-3", cycle: "annual", price_amount: 48000, discount_percent: 20, is_active: true, sort_order: 4 },
    ] },
  { ...base, id: "pl-3", key: "business", name: "Business", description: "Multi-branch", price_amount: 15000, billing_period: "month", features: ["Everything in Pro"], limits: { products: null }, sort_order: 3,
    prices: [
      { id: "pp-4", cycle: "monthly", price_amount: 15000, discount_percent: 0, is_active: true, sort_order: 1 },
      { id: "pp-5", cycle: "annual", price_amount: 144000, discount_percent: 20, is_active: true, sort_order: 4 },
    ] },
];

test.describe("Settings", () => {
  test("owner sees sectioned tabs; Business tab is a View card until Edit", async ({ page }) => {
    await authenticate(page, { role: "owner", businessName: "Sunrise Stores" });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    // Tabs render; Business is the default tab, read-only until Edit.
    for (const t of ["Business", "Preferences", "Billing", "Security & Legal"]) {
      await expect(page.getByRole("button", { name: t, exact: true })).toBeVisible();
    }
    await expect(page.getByText("Business name", { exact: true })).toBeVisible();
    await expect(page.getByPlaceholder("Enter your business name")).toHaveCount(0); // view mode: no inputs
    // Edit flips the card into the form; Cancel returns to view.
    await page.getByRole("button", { name: "Edit" }).first().click();
    await expect(page.getByPlaceholder("Enter your business name")).toHaveValue("Sunrise Stores");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByPlaceholder("Enter your business name")).toHaveCount(0);
  });

  test("inventory costing method can be switched (Business tab)", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    let patched: any = null;
    await page.route("**/rest/v1/businesses**", (r) => {
      if (r.request().method() === "PATCH") { patched = r.request().postDataJSON(); return r.fulfill({ status: 200, contentType: "application/json", body: "[]" }); }
      return r.fallback();
    });
    await page.goto("/settings");
    await expect(page.getByText("Inventory costing")).toBeVisible();
    await page.getByText("Last cost", { exact: true }).click();
    await expect(page.getByText("Costing method updated")).toBeVisible();
    expect(patched.valuation_method).toBe("last_cost");
  });

  test("module-specific Settings are hidden when the business lacks the module", async ({ page }) => {
    // The Free plan resolves to FREE_MODULES (no export_invoices / general_store / production /
    // expenditure), so those modules' Settings should not render.
    await authenticate(page, { role: "owner" });
    await stubRows(page, "plans", plans);
    await page.goto("/settings");

    // Business tab: no Exporter Profile (Export Invoice module absent).
    await expect(page.getByText("Exporter Profile", { exact: true })).toHaveCount(0);

    // Preferences: core alerts stay; module-specific alerts are gone.
    await page.getByRole("button", { name: "Preferences", exact: true }).click();
    await expect(page.getByText("Low stock alerts")).toBeVisible();
    await expect(page.getByText("Overdue invoice alerts")).toBeVisible();
    await expect(page.getByText("General Store alerts")).toHaveCount(0);
    await expect(page.getByText("Production alerts")).toHaveCount(0);
    await expect(page.getByText("Expenditure alerts")).toHaveCount(0);
  });

  test("subscription plans come from the catalogue (Billing tab)", async ({ page }) => {
    await authenticate(page, { role: "owner", businessName: "Sunrise Stores" });
    await stubRows(page, "plans", plans);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    await expect(page.getByText("Subscription Plan", { exact: true })).toBeVisible();
    await expect(page.getByText("Pro", { exact: true })).toBeVisible();
    await expect(page.getByText("Current plan")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Pay ₦/ })).toHaveCount(2); // paid plans now collect in-app
    // billing cycles + promo come from the catalogue
    await expect(page.getByRole("button", { name: "Annually" }).first()).toBeVisible();
    await expect(page.getByText(/Launch offer/)).toBeVisible();
  });

  test("a referred first-time payer's discount auto-applies to the plan prices (Billing tab)", async ({ page }) => {
    await authenticate(page, { role: "owner", businessName: "Sunrise Stores", onRoutes: async (p) => {
      // Referred by a valid code + never paid → the RPC returns the first-payment discount.
      await p.route("**/rest/v1/rpc/my_referee_discount**", (r) =>
        r.fulfill({ status: 200, contentType: "application/json", body: "20" }));
    }});
    await stubRows(page, "plans", plans);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    // Pro monthly: ₦5,000 − 10% launch promo = ₦4,500, then − 20% referral = ₦3,600.
    await expect(page.getByText("Referral · 20% off first payment").first()).toBeVisible();
    await expect(page.getByText("₦3,600").first()).toBeVisible();
    // The pay button carries the discounted amount, so you pay what you were shown.
    await expect(page.getByRole("button", { name: "Pay ₦3,600" })).toBeVisible();
  });

  test("switching to a cycle you aren't billed on becomes payable, not 'Current plan'", async ({ page }) => {
    // Subscribed to Pro MONTHLY. The Pro card should read "Current plan" on monthly...
    await authenticate(page, { role: "owner", subscriptionTier: "pro", subscriptionCycle: "monthly" });
    await stubRows(page, "plans", plans);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    const proCard = page.getByTestId("plan-card-pro");
    await expect(proCard.getByText("Current plan")).toBeVisible();

    // ...and offer to sell the annual cycle once it's selected, instead of dead-ending.
    await proCard.getByRole("button", { name: "Annually" }).click();
    await expect(page.getByRole("button", { name: /Switch to Annually · ₦/ })).toBeVisible();
  });

  test("a lower PAID plan is payable; only Free is a no-payment downgrade", async ({ page }) => {
    // On Business: Pro is a downgrade but still costs money, so it must be payable.
    await authenticate(page, { role: "owner", subscriptionTier: "business", subscriptionCycle: "monthly" });
    await stubRows(page, "plans", plans);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    // Free (₦0) is the only no-payment card.
    await expect(page.getByRole("button", { name: "Downgrade to Free" })).toHaveCount(1);
    // Pro is cheaper than Business but still priced — it gets a Pay button.
    await expect(page.getByRole("button", { name: /^Pay ₦/ })).toHaveCount(1);
  });

  test("downgrading to Free confirms first and takes effect at the end of the paid period", async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await authenticate(page, { role: "owner", subscriptionTier: "business", subscriptionCycle: "monthly", onRoutes: async (p) => {
      await p.route("**/rest/v1/rpc/set_subscription_cancel**", (r) => {
        sent = r.request().postDataJSON();
        return r.fulfill({ status: 200, contentType: "application/json", body: "true" });
      });
    }});
    await stubRows(page, "plans", plans);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    await page.getByRole("button", { name: "Downgrade to Free" }).click();

    // It must be explicit that they keep what they paid for — nothing is refunded.
    await expect(page.getByText(/keep your current plan.*until|end of your current period/i)).toBeVisible();
    await page.getByRole("button", { name: "Move to Free" }).click();
    expect(sent).toMatchObject({ p_cancel: true });
    await expect(page.getByText(/move to Free at the end of your period/i)).toBeVisible();
  });

  test("a pending move to Free is shown and can be called off", async ({ page }) => {
    let sent: Record<string, unknown> | null = null;
    await authenticate(page, { role: "owner", subscriptionTier: "business", subscriptionCycle: "monthly",
      cancelAtPeriodEnd: true, onRoutes: async (p) => {
        await p.route("**/rest/v1/rpc/set_subscription_cancel**", (r) => {
          sent = r.request().postDataJSON();
          return r.fulfill({ status: 200, contentType: "application/json", body: "false" });
        });
      } });
    await stubRows(page, "plans", plans);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    await expect(page.getByText(/Moving to Free/)).toBeVisible();
    await page.getByRole("button", { name: "Keep my current plan" }).click();
    expect(sent).toMatchObject({ p_cancel: false });
  });

  test("paying hands off to Monnify with the amount bound server-side", async ({ page }) => {
    let sentBody: Record<string, unknown> | null = null;
    await authenticate(page, { role: "owner", businessName: "Sunrise Stores", onRoutes: async (p) => {
      await p.route("**/functions/v1/create-payment**", (r) => {
        sentBody = r.request().postDataJSON();
        return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          method: "transfer", reference: "ITV-abc-1", amount: 4500,
          quote: { amount: 4500, currency: "NGN", list_amount: 5000, cycle_discount: 0, referee_discount: 0 },
          checkout_url: "https://sandbox.monnify.com/checkout/ITV-abc-1",
        }) });
      });
    }});
    // Capture the hand-off instead of opening a real tab.
    await page.addInitScript(() => {
      (window as unknown as { __opened: string[] }).__opened = [];
      window.open = ((url?: string | URL) => {
        (window as unknown as { __opened: string[] }).__opened.push(String(url));
        return null;
      }) as typeof window.open;
    });
    await stubRows(page, "plans", plans);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    await page.getByRole("button", { name: /^Pay ₦/ }).first().click();

    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /Bank transfer/ }).click();
    await expect(dialog.getByText(/Waiting for confirmation/)).toBeVisible();

    // The amount is bound to Monnify's transaction, so the customer can't pay a different figure.
    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
    expect(opened).toContain("https://sandbox.monnify.com/checkout/ITV-abc-1");
    // The browser asks for a plan + cycle only — never a price. The server decides what it costs.
    expect(sentBody).toMatchObject({ plan_key: expect.any(String), cycle: expect.any(String), method: "transfer" });
    expect(sentBody).not.toHaveProperty("amount");
  });

  test("the plan-expiry badge takes you straight to paying for the plan you're on", async ({ page }) => {
    // Expiring in 3 days: the header badge should land on Billing with the payment already open,
    // rather than dropping the user on Settings to hunt for it.
    await authenticate(page, { role: "owner", subscriptionTier: "pro", subscriptionCycle: "monthly",
      subscriptionRenewsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    await stubRows(page, "plans", plans);
    await page.goto("/");
    const badge = page.getByRole("link", { name: /Expires in/ });
    await expect(badge).toBeVisible();
    await badge.click();
    await expect(page).toHaveURL(/tab=billing/);
    await expect(page.getByRole("dialog").getByText(/Pay for Pro/)).toBeVisible();
  });

  test("an expiring plan can be renewed from its own card", async ({ page }) => {
    await authenticate(page, { role: "owner", subscriptionTier: "pro", subscriptionCycle: "monthly",
      subscriptionRenewsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    await stubRows(page, "plans", plans);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    // Previously the current plan showed a label and nothing else — no way to pay for the next period.
    await expect(page.getByRole("button", { name: /^Renew · ₦/ })).toBeVisible();
  });

  test("billing history pages at 5 and offers view + download per payment", async ({ page }) => {
    // 7 payments → 2 pages at 5 per page.
    const history = Array.from({ length: 7 }, (_, i) => ({
      id: `pay-${i}`, paid_at: `2026-0${(i % 9) + 1}-15`, plan_key: "pro", cycle: "monthly",
      amount: 4500, currency: "NGN", reference: `MNFY-${i}`, method: i === 0 ? "card" : "transfer",
    }));
    await authenticate(page, { role: "owner", subscriptionTier: "pro", subscriptionCycle: "monthly", onRoutes: async (p) => {
      await p.route("**/rest/v1/rpc/my_billing_history**", (r) =>
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(history) }));
    }});
    await stubRows(page, "plans", plans);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Billing", exact: true }).click();

    await expect(page.getByText("Billing history")).toBeVisible();
    const card = page.getByTestId("billing-history");
    // 5 on the first page, not all 7.
    await expect(page.getByText("iTrova Pro — Monthly")).toHaveCount(5);

    // Each payment offers both actions.
    await page.getByRole("button", { name: /Actions for/ }).first().click();
    await expect(page.getByRole("menuitem", { name: "View invoice" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Download invoice" })).toBeVisible();
    await page.getByRole("menuitem", { name: "View invoice" }).click();
    await expect(page.getByRole("dialog").getByText("Total paid")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click(); // the X is also named Close

    // Page 2 holds the remaining 2.
    await card.getByRole("button", { name: "Next page" }).click();
    await expect(page.getByText("iTrova Pro — Monthly")).toHaveCount(2);
  });

  test("Refer & earn card shows the code, share actions and referral count (Billing tab)", async ({ page }) => {
    await authenticate(page, { role: "owner", businessName: "Sunrise Stores", onRoutes: async (p) => {
      const j = (r: Parameters<Parameters<typeof p.route>[1]>[0], body: unknown) =>
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      await p.route("**/rest/v1/referral_config**", (r) => j(r, { business_share_percent: 25, referee_discount_percent: 20 }));
      await p.route("**/rest/v1/rpc/my_referral_earnings**", (r) => j(r, [{ referred_count: 4, converted_count: 2, earned: 45000, credited: 0, accrued: 45000 }]));
      await p.route("**/rest/v1/rpc/ensure_referral_code**", (r) => j(r, "SUNRISESTO0305"));
    }});
    await page.goto("/settings");
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    await expect(page.getByText("Refer & earn")).toBeVisible();
    // Owner has no code yet → generate it → code + share + counts appear.
    await page.getByRole("button", { name: /Get my referral code/ }).click();
    await expect(page.getByText("SUNRISESTO0305")).toBeVisible();
    await expect(page.getByRole("button", { name: /Share on WhatsApp/ })).toBeVisible();
    await expect(page.getByText("businesses referred")).toBeVisible();
    await expect(page.getByText("now subscribed")).toBeVisible();
    // Earnings accrue as subscription credit at the business share rate.
    await expect(page.getByText("credit available")).toBeVisible();
    await expect(page.getByText("₦45,000").first()).toBeVisible();
  });
});

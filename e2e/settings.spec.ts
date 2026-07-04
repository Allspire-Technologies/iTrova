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

  test("subscription plans come from the catalogue (Billing tab)", async ({ page }) => {
    await authenticate(page, { role: "owner", businessName: "Sunrise Stores" });
    await stubRows(page, "plans", plans);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Billing", exact: true }).click();
    await expect(page.getByText("Subscription Plan", { exact: true })).toBeVisible();
    await expect(page.getByText("Pro", { exact: true })).toBeVisible();
    await expect(page.getByText("Current plan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request upgrade" })).toHaveCount(2);
    // billing cycles + promo come from the catalogue
    await expect(page.getByRole("button", { name: "Annually" }).first()).toBeVisible();
    await expect(page.getByText(/Launch offer/)).toBeVisible();
  });
});

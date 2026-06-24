import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const plans = [
  { id: "pl-1", key: "free", name: "Free", description: "Small shops", price_amount: 0, price_currency: "NGN", billing_period: null, features: ["Inventory management", "POS & sales"], limits: { products: 100 }, is_active: true, sort_order: 1 },
  { id: "pl-2", key: "pro", name: "Pro", description: "Growing", price_amount: 5000, price_currency: "NGN", billing_period: "month", features: ["Everything in Free", "AI Insights"], limits: { products: null }, is_active: true, sort_order: 2 },
  { id: "pl-3", key: "business", name: "Business", description: "Multi-branch", price_amount: 15000, price_currency: "NGN", billing_period: "month", features: ["Everything in Pro"], limits: { products: null }, is_active: true, sort_order: 3 },
];

test.describe("Settings", () => {
  test("owner sees business profile and subscription", async ({ page }) => {
    await authenticate(page, { role: "owner", businessName: "Sunrise Stores" });
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Business name", { exact: true })).toBeVisible();
    await expect(page.getByText("Subscription Plan", { exact: true })).toBeVisible();
  });

  test("subscription plans come from the catalogue", async ({ page }) => {
    await authenticate(page, { role: "owner", businessName: "Sunrise Stores" });
    await stubRows(page, "plans", plans);
    await page.goto("/settings");
    await expect(page.getByText("Subscription Plan", { exact: true })).toBeVisible();
    await expect(page.getByText("Pro", { exact: true })).toBeVisible();
    await expect(page.getByText("Current plan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Request upgrade" })).toHaveCount(2);
  });
});

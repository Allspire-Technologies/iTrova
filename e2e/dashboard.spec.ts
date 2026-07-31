import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";
import { seedDemo, DEMO_OWNER, DEMO_BUSINESS } from "./support/demo";

test.describe("Dashboard", () => {
  test("renders the greeting, business name and metric cards", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await expect(page).toHaveURL("/");
    await expect(page.getByText(/Good (morning|afternoon|evening), Ada/)).toBeVisible();
    await expect(page.getByText("Sunrise Stores")).toBeVisible();
    await expect(page.getByText("Today's Sales")).toBeVisible();
    await expect(page.getByText("Products in Stock")).toBeVisible();
    await expect(page.getByText("Open Invoices")).toBeVisible();
  });

  // Morning starts at midnight; afternoon at noon; evening at 5pm.
  for (const [hour, expected] of [[8, "Good morning"], [14, "Good afternoon"], [20, "Good evening"]] as const) {
    test(`greets "${expected}" at ${hour}:00`, async ({ page }) => {
      await page.clock.setFixedTime(new Date(2026, 6, 31, hour, 0, 0));
      await authenticate(page, { ownerName: "Ada Obi" });
      await expect(page.getByRole("heading", { name: new RegExp(`${expected}, Ada`) })).toBeVisible();
    });
  }

  test("shows money owed and cash collected for a part-paid invoice", async ({ page }) => {
    const today = new Date().toISOString();
    await authenticate(page, { ownerName: "Ada Obi", onRoutes: async (p) => {
      // A ₦100k invoice with a ₦40k deposit: ₦60k is owed, ₦40k was collected today.
      await p.route("**/rest/v1/invoices**", (r) =>
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([
          { id: "inv-1", total: 100000, amount_paid: 40000, status: "issued", issue_date: today.slice(0, 10) },
        ]) }));
      await p.route("**/rest/v1/invoice_payments**", (r) =>
        r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ amount: 40000, created_at: today }]) }));
    }});
    await expect(page.getByText("Money Owed")).toBeVisible();
    await expect(page.getByText("₦60,000")).toBeVisible(); // 100k total − 40k paid
    await expect(page.getByText("Collected Today")).toBeVisible();
    await expect(page.getByText("₦40,000")).toBeVisible(); // the deposit
  });

  test.describe("on a mobile viewport", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    // The Recent activity / AI Insights grid used a bare `grid` (auto track), so the activity
    // rows' `truncate` (nowrap) text forced the column wider than the screen. Guard against it.
    test("renders the seeded feed without horizontal overflow", async ({ page }) => {
      await authenticate(page, { ownerName: DEMO_OWNER, businessName: DEMO_BUSINESS, onRoutes: seedDemo });
      await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(/marked partial/)).toBeVisible(); // the long activity line
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
});

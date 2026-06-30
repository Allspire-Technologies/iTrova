import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";
import { seedDemo, DEMO_OWNER, DEMO_BUSINESS } from "./support/demo";

test.describe("Dashboard", () => {
  test("renders the greeting, business name and metric cards", async ({ page }) => {
    await authenticate(page, { ownerName: "Ada Obi", businessName: "Sunrise Stores" });
    await expect(page).toHaveURL("/");
    await expect(page.getByText(/Good day, Ada/)).toBeVisible();
    await expect(page.getByText("Sunrise Stores")).toBeVisible();
    await expect(page.getByText("Today's Sales")).toBeVisible();
    await expect(page.getByText("Products in Stock")).toBeVisible();
    await expect(page.getByText("Open Invoices")).toBeVisible();
  });

  test.describe("on a mobile viewport", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    // The Recent activity / AI Insights grid used a bare `grid` (auto track), so the activity
    // rows' `truncate` (nowrap) text forced the column wider than the screen. Guard against it.
    test("renders the seeded feed without horizontal overflow", async ({ page }) => {
      await authenticate(page, { ownerName: DEMO_OWNER, businessName: DEMO_BUSINESS, onRoutes: seedDemo });
      await expect(page.getByRole("heading", { name: /Good day/ })).toBeVisible({ timeout: 20000 });
      await expect(page.getByText(/marked partial/)).toBeVisible(); // the long activity line
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
});

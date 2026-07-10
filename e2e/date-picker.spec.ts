import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

// The shared DatePicker: a tappable field with a calendar icon that opens a calendar popover and
// shows the picked day as "DD MMM YYYY". Exercised via the Inventory add-product expiry field.
test.describe("Date picker", () => {
  test("opens the calendar, picks a day, and shows it as DD MMM YYYY", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "products", []);
    await page.goto("/inventory");

    await page.getByRole("button", { name: "Add product" }).first().click();
    const dialog = page.getByRole("dialog");

    // Empty state shows the placeholder; clicking opens a calendar grid.
    const field = dialog.getByRole("button", { name: "Select date" });
    await expect(field).toBeVisible();
    await field.click();
    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible();

    // Pick the 15th of whatever month is shown, then assert a "DD MMM YYYY" value is displayed.
    await grid.getByRole("gridcell", { name: "15", exact: true }).click();
    await expect(grid).toBeHidden(); // popover closes on select
    await expect(dialog.getByRole("button", { name: /^15 [A-Z][a-z]{2} \d{4}$/ })).toBeVisible();
  });
});

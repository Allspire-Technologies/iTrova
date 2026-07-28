import { test, expect } from "@playwright/test";
import { authenticate } from "./support/auth";

test.describe("App shell — theme, search, what's new", () => {
  test("Light/Dark toggle flips the theme and persists across reload", async ({ page }) => {
    await authenticate(page);
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(html).toHaveClass(/dark/);

    // The pre-paint inline script re-applies the saved choice after a reload.
    await page.reload();
    await expect(html).toHaveClass(/dark/);

    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test("global search opens (button + Ctrl/⌘K) and navigates to a page", async ({ page }) => {
    await authenticate(page);

    // Keyboard shortcut opens it.
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByPlaceholder(/Search pages/)).toBeVisible();
    await page.keyboard.press("Escape");

    // Header button opens it; typing a page name filters the Pages group; selecting navigates.
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByPlaceholder(/Search pages/).fill("Settings");
    await page.getByRole("option", { name: "Settings" }).click();
    await expect(page).toHaveURL(/\/settings$/);
  });

  test("one-time What's new wizard steps through features and dismisses", async ({ page }) => {
    await authenticate(page, { showWhatsNew: true });

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("What's new")).toBeVisible();
    await expect(dialog.getByText("Dark mode")).toBeVisible();

    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByText("Search anything")).toBeVisible();

    await dialog.getByRole("button", { name: "Got it" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

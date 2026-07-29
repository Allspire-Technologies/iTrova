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

  test("keyboard shortcuts dialog opens via '?' and from the search palette", async ({ page }) => {
    await authenticate(page);

    // "?" opens the reference.
    await page.keyboard.press("Shift+Slash");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
    await expect(page.getByText("Open search")).toBeVisible();
    await expect(page.getByText("Show / hide the sidebar")).toBeVisible();
    await page.keyboard.press("Escape");

    // Also discoverable from the search palette's Help entry.
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("option", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  });

  test("one-time What's new wizard steps through features and dismisses", async ({ page }) => {
    await authenticate(page, { showWhatsNew: true });

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("What's new")).toBeVisible();
    await expect(dialog.getByText("Dark mode")).toBeVisible();

    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByText("Search anything")).toBeVisible();

    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByText("Invoice your inventory")).toBeVisible();

    // The last entry lives on a page, so its button takes you there and dismisses.
    await dialog.getByRole("button", { name: "Open Invoices" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/invoices/);
  });
});

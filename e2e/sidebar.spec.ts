import { test, expect } from "@playwright/test";
import { authenticate, stubRows } from "./support/auth";

const ALL_MODULES = [
  "inventory", "pos", "suppliers", "raw_materials", "general_store", "production",
  "invoices", "export_invoices", "purchase_orders", "expenditure", "team", "reports", "insights",
];
const planWith = (modules: string[]) => ({
  id: "pl-1", key: "free", name: "Free", description: null,
  price_amount: 0, price_currency: "NGN", billing_period: null,
  features: [], limits: {}, is_active: true, sort_order: 1,
  business_id: null, promo_percent: 0, promo_label: null, promo_until: null,
  modules, prices: [],
});

test.describe("Sidebar grouping", () => {
  test("pinned items, section headers and bottom Settings render for a full plan", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "plans", [planWith(ALL_MODULES)]);
    await page.goto("/");
    const side = page.locator("aside");
    // Pinned (flat, top)
    for (const label of ["Dashboard", "Point of Sale", "Inventory", "Reports"]) {
      await expect(side.getByRole("link", { name: label })).toBeVisible();
    }
    // Collapsible section headers
    for (const section of ["Sales", "Stock", "Buy", "More"]) {
      await expect(side.getByRole("button", { name: section })).toBeVisible();
    }
    // Settings pinned at the bottom (with Sign out)
    await expect(side.getByRole("link", { name: "Settings" })).toBeVisible();
    await expect(side.getByRole("button", { name: "Sign out" })).toBeVisible();
  });

  test("a section header toggles its items open and closed", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "plans", [planWith(ALL_MODULES)]);
    await page.goto("/"); // on Dashboard, so no section is force-open
    const side = page.locator("aside");
    await expect(side.getByRole("link", { name: "Suppliers" })).toBeVisible(); // Buy open by default
    await side.getByRole("button", { name: "Buy" }).click();
    await expect(side.getByRole("link", { name: "Suppliers" })).toHaveCount(0); // collapsed
    await side.getByRole("button", { name: "Buy" }).click();
    await expect(side.getByRole("link", { name: "Suppliers" })).toBeVisible(); // expanded again
  });

  test("the section owning the active route is open", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "plans", [planWith(ALL_MODULES)]);
    await stubRows(page, "invoices", []);
    await page.goto("/invoices"); // Sales section owns this route
    const side = page.locator("aside");
    await expect(side.getByRole("link", { name: "Invoices" })).toBeVisible();
  });

  test("sections with no visible modules are hidden entirely", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    // Only Sales (invoices) + Buy (suppliers) have any granted module here.
    await stubRows(page, "plans", [planWith(["inventory", "pos", "suppliers", "invoices"])]);
    await page.goto("/");
    const side = page.locator("aside");
    await expect(side.getByRole("button", { name: "Sales" })).toBeVisible();
    await expect(side.getByRole("button", { name: "Buy" })).toBeVisible();
    await expect(side.getByRole("button", { name: "Stock" })).toHaveCount(0);
    await expect(side.getByRole("button", { name: "More" })).toHaveCount(0);
    await expect(side.getByRole("link", { name: "Reports" })).toHaveCount(0); // pinned but not granted
  });

  test("collapsing to the icon rail drops the section headers but keeps the module icons", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "plans", [planWith(ALL_MODULES)]);
    await page.goto("/");
    const side = page.locator("aside");
    await side.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(side.getByRole("button", { name: "Sales" })).toHaveCount(0); // no section chrome
    await expect(side.getByRole("link", { name: "Point of Sale" })).toBeVisible(); // icons keep an aria-label
    await expect(side.getByRole("link", { name: "Settings" })).toBeVisible();
  });

  test("every sidebar row shares one geometry, and the icon rail stays centred while scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 }); // short enough to overflow the nav
    await authenticate(page, { role: "owner" });
    await stubRows(page, "plans", [planWith(ALL_MODULES)]);
    await page.goto("/");
    const aside = page.locator("aside").first();
    const nav = aside.locator("nav").first();

    for (const collapse of [false, true]) {
      if (collapse) await aside.getByRole("button", { name: "Collapse sidebar" }).click();
      expect(await nav.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

      // The scrolling nav loses this much width to its scrollbar; the pinned footer doesn't scroll,
      // so it keeps it. That's 0 where scrollbars overlay (most desktops) but a few px on platforms
      // that reserve space — so it's the tolerance, not a failure. Measured rather than hardcoded
      // because the width differs per platform: asserting exact equality made this test flaky on CI.
      const gutter = await nav.evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth);

      // A nav row and the pinned Settings row line up: identical left edge, same width bar the gutter.
      const row = (await nav.locator("a").first().boundingBox())!;
      const settings = (await aside.locator("a[href='/settings']").last().boundingBox())!;
      expect(settings.x).toBeCloseTo(row.x, 0);                       // left edge is exact
      expect(Math.abs(settings.width - row.width)).toBeLessThanOrEqual(gutter + 1);
      if (collapse) {
        const box = (await aside.boundingBox())!;
        const icon = (await nav.locator("a svg").first().boundingBox())!;
        // Centred in the space actually available — a reserved scrollbar shifts that centre by half.
        const drift = Math.abs((icon.x + icon.width / 2) - (box.x + box.width / 2));
        expect(drift).toBeLessThanOrEqual(gutter / 2 + 1);
      }
    }
  });

  test("the collapse tooltip floats above the header instead of clipping under it", async ({ page }) => {
    await authenticate(page, { role: "owner" });
    await stubRows(page, "plans", [planWith(ALL_MODULES)]);
    await page.goto("/");
    await page.getByRole("button", { name: "Collapse sidebar" }).hover();
    const tip = page.getByRole("tooltip").filter({ hasText: "Collapse sidebar" });
    await expect(tip).toBeVisible();
    // Portalled out of the sidebar, so no neighbouring bar can paint over it.
    expect(await tip.evaluate((el) => el.closest("aside") === null)).toBe(true);
    const topmost = await tip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.textContent ?? "";
    });
    expect(topmost).toContain("Collapse sidebar");
  });
});

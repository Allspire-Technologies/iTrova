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

    // The sidebar animates its width (transition-all duration-200). CI's DOM snapshot showed the
    // failure in the COLLAPSED pass — i.e. mid-animation — with the mismatch varying run to run
    // (13.0px, then 12.0px on retry), which is a moving layout, not a broken one. Kill the animation
    // outright so the geometry assertions measure a settled sidebar rather than racing it.
    await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
    const settled = async () => {
      await expect(aside).toBeVisible();      // it mounts behind a skeleton, so wait for it first
      let prev = -1;
      await expect.poll(async () => {
        const box = await aside.boundingBox();
        if (!box) return false;
        const same = box.width === prev;
        prev = box.width;
        return same;
      }, { timeout: 5000, intervals: [100] }).toBe(true);
    };

    for (const collapse of [false, true]) {
      if (collapse) await aside.getByRole("button", { name: "Collapse sidebar" }).click();
      await settled();
      expect(await nav.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

      // Take every measurement in ONE evaluate. Separate boundingBox() calls are separate async
      // round-trips, so during the width animation each samples a different frame — which is how
      // this produced a 13.0px mismatch on CI and 12.0px on the retry, while passing locally.
      const m = await aside.evaluate((el) => {
        const nav = el.querySelector("nav")!;
        const row = nav.querySelector("a")!.getBoundingClientRect();
        const links = el.querySelectorAll("a[href='/settings']");
        const settings = links[links.length - 1].getBoundingClientRect();
        const icon = nav.querySelector("a svg")!.getBoundingClientRect();
        const aside = el.getBoundingClientRect();
        return {
          rowX: row.x, rowW: row.width,
          setX: settings.x, setW: settings.width,
          iconCentre: icon.x + icon.width / 2,
          asideCentre: aside.x + aside.width / 2,
          // The scrolling nav loses this to a reserved scrollbar; the pinned footer doesn't scroll,
          // so it keeps it. 0 where scrollbars overlay, a few px where they take space.
          gutter: (nav as HTMLElement).offsetWidth - nav.clientWidth,
        };
      });

      // A nav row and the pinned Settings row line up. ±0.5px on the left edge is deliberate, not
      // sloppiness: getBoundingClientRect() returns subpixel floats that differ across renderers,
      // and this test has already flaked on CI twice for over-asserting geometry. A real
      // misalignment would be padding-sized (≥4px), which this still catches.
      expect(m.setX).toBeCloseTo(m.rowX, 0);
      expect(Math.abs(m.setW - m.rowW)).toBeLessThanOrEqual(m.gutter + 1);
      if (collapse) {
        // Centred in the space actually available — a reserved scrollbar shifts that centre by half.
        expect(Math.abs(m.iconCentre - m.asideCentre)).toBeLessThanOrEqual(m.gutter / 2 + 1);
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

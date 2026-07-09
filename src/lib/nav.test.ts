import { describe, it, expect } from "vitest";
import {
  visiblePinned, visibleSections, allVisibleModuleItems, sectionKeyForPath, isNavItemVisible,
  type NavGrants,
} from "./nav";

// An owner sees everything; a scoped member only sees granted modules.
const owner: NavGrants = { hasModule: () => true, can: () => true };
const only = (mods: string[]): NavGrants => ({
  hasModule: (k) => mods.includes(k),
  can: (m) => mods.includes(m),
});

describe("nav visibility", () => {
  it("owner sees all pinned items and all four sections", () => {
    expect(visiblePinned(owner).map((i) => i.to)).toEqual(["/", "/pos", "/inventory", "/reports"]);
    expect(visibleSections(owner).map((s) => s.key)).toEqual(["sales", "stock", "buy", "more"]);
  });

  it("ungated items (Dashboard) are always visible", () => {
    expect(isNavItemVisible({ to: "/", label: "Dashboard", icon: {} as never }, only([]))).toBe(true);
  });

  it("drops a section when the member can see none of its modules", () => {
    // Cashier-ish: only POS + Inventory. Sales/Stock/Buy/More all disappear.
    const g = only(["pos", "inventory"]);
    expect(visiblePinned(g).map((i) => i.to)).toEqual(["/", "/pos", "/inventory"]); // Reports gone
    expect(visibleSections(g)).toEqual([]);
  });

  it("keeps a section but only its granted items", () => {
    const g = only(["invoices"]); // Sales section, Invoices only (no Export Invoice)
    const sales = visibleSections(g).find((s) => s.key === "sales");
    expect(sales?.items.map((i) => i.to)).toEqual(["/invoices"]);
    expect(visibleSections(g).map((s) => s.key)).toEqual(["sales"]);
  });

  it("flat rail list = pinned then section items, in order", () => {
    const g = only(["pos", "invoices", "team"]);
    expect(allVisibleModuleItems(g).map((i) => i.to)).toEqual(["/", "/pos", "/invoices", "/team"]);
  });
});

describe("sectionKeyForPath", () => {
  it("resolves a section from an exact or nested path", () => {
    expect(sectionKeyForPath("/invoices")).toBe("sales");
    expect(sectionKeyForPath("/export-invoice/new")).toBe("sales");
    expect(sectionKeyForPath("/production")).toBe("stock");
    expect(sectionKeyForPath("/expenditure")).toBe("buy");
    expect(sectionKeyForPath("/team")).toBe("more");
  });

  it("returns null for pinned routes and Settings", () => {
    expect(sectionKeyForPath("/")).toBeNull();
    expect(sectionKeyForPath("/reports")).toBeNull();
    expect(sectionKeyForPath("/settings")).toBeNull();
  });
});

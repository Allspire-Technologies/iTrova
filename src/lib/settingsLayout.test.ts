import { describe, it, expect } from "vitest";
import {
  SETTINGS_PAGE_CLASS,
  SETTINGS_FIELD_GRID,
  SETTINGS_PLANS_GRID,
  fillsViewportWidth,
  isMobileFirstGrid,
} from "./settingsLayout";

describe("fillsViewportWidth", () => {
  it("accepts a full-width container with no cap", () => {
    expect(fillsViewportWidth("space-y-6 w-full")).toBe(true);
  });
  it("rejects a container capped with max-width", () => {
    expect(fillsViewportWidth("space-y-6 w-full max-w-3xl")).toBe(false);
    expect(fillsViewportWidth("w-full lg:max-w-3xl")).toBe(false);
  });
  it("rejects a container that is not full width", () => {
    expect(fillsViewportWidth("space-y-6")).toBe(false);
  });
});

describe("isMobileFirstGrid", () => {
  it("accepts a single-column-on-mobile, multi-column-above grid", () => {
    expect(isMobileFirstGrid("grid grid-cols-1 sm:grid-cols-2 gap-4")).toBe(true);
    expect(isMobileFirstGrid("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4")).toBe(true);
  });
  it("rejects a grid that is multi-column on mobile", () => {
    expect(isMobileFirstGrid("grid grid-cols-2 gap-4")).toBe(false);
  });
});

describe("settings layout constants", () => {
  it("keeps the page container spanning the full viewport width", () => {
    expect(fillsViewportWidth(SETTINGS_PAGE_CLASS)).toBe(true);
  });
  it("keeps form and plan grids mobile-first", () => {
    expect(isMobileFirstGrid(SETTINGS_FIELD_GRID)).toBe(true);
    expect(isMobileFirstGrid(SETTINGS_PLANS_GRID)).toBe(true);
  });
});

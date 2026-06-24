import { describe, it, expect } from "vitest";
import { canAccessModule } from "./moduleAccess";

describe("canAccessModule", () => {
  it("grants everything when no modules are configured (opt-in gating)", () => {
    expect(canAccessModule(null, "inventory")).toBe(true);
    expect(canAccessModule(undefined, "inventory")).toBe(true);
    expect(canAccessModule([], "inventory")).toBe(true);
  });
  it("grants only listed modules once a plan configures them", () => {
    expect(canAccessModule(["inventory", "pos"], "inventory")).toBe(true);
    expect(canAccessModule(["inventory", "pos"], "insights")).toBe(false);
  });
});

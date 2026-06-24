import { describe, it, expect } from "vitest";
import { isDirty, isPasswordFormReady } from "./settingsForms";

describe("isDirty", () => {
  it("is false when every value matches its baseline", () => {
    expect(isDirty(["Acme", "Ada"], ["Acme", "Ada"])).toBe(false);
    expect(isDirty([""], [""])).toBe(false);
  });
  it("is true when any value differs", () => {
    expect(isDirty(["Acme Co", "Ada"], ["Acme", "Ada"])).toBe(true);
    expect(isDirty(["NGN", "Africa/Lagos"], ["NGN", "UTC"])).toBe(true);
  });
  it("treats whitespace changes as dirty", () => {
    expect(isDirty(["Acme "], ["Acme"])).toBe(true);
  });
});

describe("isPasswordFormReady", () => {
  it("is false until both fields are filled", () => {
    expect(isPasswordFormReady("", "")).toBe(false);
    expect(isPasswordFormReady("secret123", "")).toBe(false);
    expect(isPasswordFormReady("", "secret123")).toBe(false);
  });
  it("is true once both fields have content", () => {
    expect(isPasswordFormReady("secret123", "secret123")).toBe(true);
    expect(isPasswordFormReady("a", "b")).toBe(true);
  });
});

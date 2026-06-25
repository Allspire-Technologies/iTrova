import { describe, it, expect } from "vitest";
import { isEmailConfirmed, normalizeEmail, isValidEmail, verifyAction } from "./emailVerification";

describe("isEmailConfirmed", () => {
  it("is true only when email_confirmed_at is set", () => {
    expect(isEmailConfirmed({ email_confirmed_at: "2026-06-25T00:00:00Z" })).toBe(true);
    expect(isEmailConfirmed({ email_confirmed_at: null })).toBe(false);
    expect(isEmailConfirmed({})).toBe(false);
    expect(isEmailConfirmed(null)).toBe(false);
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
  });
});

describe("isValidEmail", () => {
  it("accepts a well-formed address", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("  user@example.com ")).toBe(true);
  });
  it("rejects malformed input", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("user@")).toBe(false);
    expect(isValidEmail("user example.com")).toBe(false);
    expect(isValidEmail("user@example")).toBe(false);
  });
});

describe("verifyAction", () => {
  it("resends when the address is unchanged (case/space-insensitive)", () => {
    expect(verifyAction("user@example.com", "user@example.com")).toBe("resend");
    expect(verifyAction("user@example.com", "  USER@example.com ")).toBe("resend");
  });
  it("changes when the address differs", () => {
    expect(verifyAction("user@example.com", "new@example.com")).toBe("change");
    expect(verifyAction(null, "new@example.com")).toBe("change");
  });
});

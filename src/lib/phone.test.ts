import { describe, it, expect } from "vitest";
import { isValidPhone, normalizePhone } from "./phone";

describe("isValidPhone", () => {
  it("accepts local 11-digit and international numbers", () => {
    expect(isValidPhone("08031234567")).toBe(true);
    expect(isValidPhone("+234 803 123 4567")).toBe(true);
    expect(isValidPhone("+1 (415) 555-0142")).toBe(true);
  });
  it("rejects too-short, empty or non-numeric input", () => {
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone("not a phone")).toBe(false);
  });
  it("rejects too-long numbers (>15 digits)", () => {
    expect(isValidPhone("1234567890123456")).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("keeps digits and a single leading +", () => {
    expect(normalizePhone("+234 803-123-4567")).toBe("+2348031234567");
    expect(normalizePhone("(080) 312 34567")).toBe("08031234567");
    expect(normalizePhone("0803++123")).toBe("0803123");
  });
});

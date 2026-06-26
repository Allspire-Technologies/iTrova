import { describe, it, expect } from "vitest";
import {
  isRenewalDueSoon, daysUntil, renewalAlertKey,
  limitWarningLevel, limitAlertKey, renewalEmail, limitEmail,
} from "./emailAlerts";

const NOW = Date.parse("2026-06-26T12:00:00Z");
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe("isRenewalDueSoon", () => {
  it("is true within the next 3 days and false outside it", () => {
    expect(isRenewalDueSoon(inDays(2), NOW)).toBe(true);
    expect(isRenewalDueSoon(inDays(3), NOW)).toBe(true);
    expect(isRenewalDueSoon(inDays(5), NOW)).toBe(false);
  });
  it("is false for already-lapsed, missing or invalid dates", () => {
    expect(isRenewalDueSoon(inDays(-1), NOW)).toBe(false);
    expect(isRenewalDueSoon(null, NOW)).toBe(false);
    expect(isRenewalDueSoon("nope", NOW)).toBe(false);
  });
});

describe("daysUntil", () => {
  it("counts whole days up, clamped at 0", () => {
    expect(daysUntil(inDays(3), NOW)).toBe(3);
    expect(daysUntil(inDays(-2), NOW)).toBe(0);
  });
});

describe("renewalAlertKey", () => {
  it("keys on the renewal date", () => {
    expect(renewalAlertKey("2026-07-25T12:00:00Z")).toBe("renewal:2026-07-25");
  });
});

describe("limitWarningLevel", () => {
  it("flags reached at/over the cap and approaching from 80%", () => {
    expect(limitWarningLevel(79, 100)).toBeNull();
    expect(limitWarningLevel(80, 100)).toBe("approaching");
    expect(limitWarningLevel(99, 100)).toBe("approaching");
    expect(limitWarningLevel(100, 100)).toBe("reached");
    expect(limitWarningLevel(101, 100)).toBe("reached");
  });
  it("returns null for unlimited or invalid caps", () => {
    expect(limitWarningLevel(500, null)).toBeNull();
    expect(limitWarningLevel(5, 0)).toBeNull();
  });
});

describe("limitAlertKey", () => {
  it("encodes resource and level", () => {
    expect(limitAlertKey("products", "approaching")).toBe("limit:products:approaching");
    expect(limitAlertKey("staff", "reached")).toBe("limit:staff:reached");
  });
});

describe("email builders", () => {
  it("renewalEmail names the plan, date and days", () => {
    const { subject, html } = renewalEmail({ businessName: "Acme", planName: "pro", renewsOn: "2026-07-25", daysLeft: 3 });
    expect(subject).toBe("Your pro plan renews in 3 days");
    expect(html).toContain("Acme");
    expect(html).toContain("2026-07-25");
  });
  it("limitEmail differs for approaching vs reached", () => {
    expect(limitEmail({ businessName: "Acme", label: "products", count: 80, limit: 100, level: "approaching" }).subject)
      .toBe("You're close to your products limit");
    const reached = limitEmail({ businessName: "Acme", label: "products", count: 100, limit: 100, level: "reached" });
    expect(reached.subject).toBe("You've reached your products limit");
    expect(reached.html).toContain("100 of 100");
  });
});

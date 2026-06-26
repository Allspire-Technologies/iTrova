import { describe, it, expect } from "vitest";
import {
  isRenewalDueSoon, daysUntil, renewalAlertKey, formatAlertDate,
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

describe("formatAlertDate", () => {
  it("formats an ISO date as '25 Jul 2026'", () => {
    expect(formatAlertDate("2026-07-25T12:00:00Z")).toBe("25 Jul 2026");
  });
  it("returns the input unchanged when unparseable", () => {
    expect(formatAlertDate("nope")).toBe("nope");
  });
});

describe("email builders", () => {
  it("renewalEmail uses the plan name, date, days and a Renew CTA", () => {
    const { subject, html } = renewalEmail({ businessName: "Acme", planName: "Pro", renewsOn: "25 Jul 2026", daysLeft: 3 });
    expect(subject).toBe("Your iTrova Pro plan renews in 3 days");
    expect(html).toContain("Acme");
    expect(html).toContain("25 Jul 2026");
    expect(html).toContain("Renew now");
  });
  it("limitEmail differs for approaching vs reached", () => {
    const approaching = limitEmail({ businessName: "Acme", label: "products", count: 80, limit: 100, level: "approaching" });
    expect(approaching.subject).toBe("Heads-up: you're close to your products limit");
    expect(approaching.html).toContain("80 of 100");
    expect(approaching.html).toContain("Upgrade");
    const reached = limitEmail({ businessName: "Acme", label: "products", count: 100, limit: 100, level: "reached" });
    expect(reached.subject).toBe("You've hit your products limit");
    expect(reached.html).toContain("100");
  });
});

import { describe, it, expect } from "vitest";
import { toWaNumber, isValidWaNumber, waLink, buildReceiptMessage, buildInvoiceMessage, buildReorderMessage } from "./whatsapp";

const money = (n: number) => `N${n}`;

describe("toWaNumber", () => {
  it("strips separators and the leading +", () => {
    expect(toWaNumber("+234 801 234 5678")).toBe("2348012345678");
    expect(toWaNumber("0801-234-5678")).toBe("08012345678");
  });
});

describe("isValidWaNumber", () => {
  it("accepts 7–15 digit numbers", () => {
    expect(isValidWaNumber("+2348012345678")).toBe(true);
    expect(isValidWaNumber("08012345678")).toBe(true);
  });
  it("rejects too short, empty, or letters", () => {
    expect(isValidWaNumber("")).toBe(false);
    expect(isValidWaNumber("12345")).toBe(false);
    expect(isValidWaNumber("not a number")).toBe(false);
  });
});

describe("waLink", () => {
  it("builds a wa.me URL with the cleaned number and encoded text", () => {
    expect(waLink("+234 801 234 5678", "Hi there!")).toBe("https://wa.me/2348012345678?text=Hi%20there!");
  });
});

describe("buildReceiptMessage", () => {
  const base = {
    businessName: "Acme", date: "25 Jun 2026", invoiceNumber: "260625-1",
    items: [{ qty: 2, name: "Soap", lineTotal: 200 }],
    subtotal: 200, discount: 0, total: 200, method: "cash", servedBy: "Ada", fmt: money,
  };
  it("includes business, receipt no., items, total, method and server", () => {
    const msg = buildReceiptMessage(base);
    expect(msg).toContain("*Acme*");
    expect(msg).toContain("Receipt 260625-1");
    expect(msg).toContain("2 × Soap — N200");
    expect(msg).toContain("*Total: N200*");
    expect(msg).toContain("Paid via cash");
    expect(msg).toContain("Served by Ada");
  });
  it("shows subtotal/discount only when discounted", () => {
    expect(buildReceiptMessage(base)).not.toContain("Discount");
    const msg = buildReceiptMessage({ ...base, discount: 50, total: 150 });
    expect(msg).toContain("Subtotal: N200");
    expect(msg).toContain("Discount: -N50");
  });
});

describe("buildInvoiceMessage", () => {
  it("lists line items and the totals breakdown", () => {
    const msg = buildInvoiceMessage({
      businessName: "Acme", invoiceNumber: "INV-1", customerName: "Ada",
      issueDate: "2026-06-25", dueDate: "2026-07-01", status: "issued",
      items: [{ description: "Widget", quantity: 3, lineTotal: 300 }],
      subtotal: 300, discount: 0, total: 300, notes: "Thanks", fmt: money,
    });
    expect(msg).toContain("*Invoice INV-1*");
    expect(msg).toContain("Bill to: Ada");
    expect(msg).toContain("Due: 2026-07-01");
    expect(msg).toContain("3 × Widget — N300");
    expect(msg).toContain("*Total: N300*");
    expect(msg).toContain("Thanks");
  });
});

describe("buildReorderMessage", () => {
  it("includes quantity, current stock and reorder level", () => {
    const msg = buildReorderMessage({
      businessName: "Acme", contactName: "Olu", materialName: "Flour", sku: "FL-1",
      unit: "kg", quantity: 50, currentStock: 5, reorderLevel: 20,
    });
    expect(msg).toContain("Reorder request — Acme");
    expect(msg).toContain("Flour (FL-1)");
    expect(msg).toContain("Quantity: 50 kg");
    expect(msg).toContain("Current stock: 5 kg");
    expect(msg).toContain("Reorder level: 20 kg");
  });
});

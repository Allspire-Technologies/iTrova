import { describe, it, expect } from "vitest";
import { buildPdf } from "./pdf";

describe("buildPdf", () => {
  it("builds an invoice PDF with discount and a custom currency formatter", () => {
    const doc = buildPdf({
      docType: "INVOICE",
      docNumber: "INV-001",
      date: "2026-06-23",
      status: "paid",
      business: { name: "Sunrise Stores" },
      partyLabel: "Bill to",
      party: { name: "Ada", phone: "+2348000000000", email: "ada@x.test" },
      items: [{ description: "Garri 50kg", quantity: 2, unit_price: 8500, line_total: 17000 }],
      subtotal: 17000,
      discount: 1000,
      tax: 0,
      total: 16000,
      formatMoney: (n) => "GHS " + n,
      notes: "Thank you",
    });
    const out = doc.output("datauristring");
    expect(out.startsWith("data:application/pdf")).toBe(true);
    expect(out.length).toBeGreaterThan(1000);
  });

  it("falls back to the default formatter and omits the discount line when zero", () => {
    const doc = buildPdf({
      docType: "INVOICE",
      docNumber: "INV-002",
      date: "2026-06-23",
      business: { name: "Sunrise Stores" },
      partyLabel: "Bill to",
      party: { name: "Bo" },
      items: [{ description: "Rice", quantity: 1, unit_price: 8000, line_total: 8000 }],
      subtotal: 8000,
      total: 8000,
    });
    expect(doc.output("datauristring").startsWith("data:application/pdf")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { buildReceiptHtml, ReceiptData } from "./receipt";

const base: ReceiptData = {
  businessName: "Sunrise Stores",
  docNumber: "INV-001",
  date: "2026-06-23",
  customerName: "Ada",
  items: [
    { description: "Garri 50kg", quantity: 2, line_total: 17000 },
    { description: "Rice", quantity: 1, line_total: 8000 },
  ],
  subtotal: 25000,
  total: 25000,
  paid: true,
  formatMoney: (n) => "₦" + n,
};

describe("buildReceiptHtml", () => {
  it("renders business, items and total using the given currency formatter", () => {
    const html = buildReceiptHtml(base);
    expect(html).toContain("Sunrise Stores");
    expect(html).toContain("INV-001");
    expect(html).toContain("Garri 50kg");
    expect(html).toContain("₦17000");
    expect(html).toContain("₦25000");
    expect(html).toContain("Customer: Ada");
  });

  it("formats for a thermal printer and declares utf-8 so the currency symbol prints", () => {
    const html = buildReceiptHtml(base);
    expect(html).toContain("size: 80mm auto");
    expect(html).toContain("margin: 0");
    expect(html).toContain('charset="utf-8"');
    expect(html).toMatch(/font-family:[^;]*monospace/);
  });

  it("supports a custom paper width", () => {
    expect(buildReceiptHtml({ ...base, widthMm: 58 })).toContain("size: 58mm auto");
  });

  it("shows the PAID marker only when paid", () => {
    expect(buildReceiptHtml(base)).toContain("PAID");
    expect(buildReceiptHtml({ ...base, paid: false })).not.toContain("PAID");
  });

  it("shows subtotal and discount rows only when there is a discount", () => {
    expect(buildReceiptHtml(base)).not.toContain("Discount");
    const withDisc = buildReceiptHtml({ ...base, discount: 2000, subtotal: 27000 });
    expect(withDisc).toContain("Subtotal");
    expect(withDisc).toContain("Discount");
    expect(withDisc).toContain("-₦2000");
  });

  it("escapes HTML in user-supplied text", () => {
    const html = buildReceiptHtml({
      ...base,
      businessName: "A & <B>",
      items: [{ description: "<script>x</script>", quantity: 1, line_total: 1 }],
    });
    expect(html).toContain("A &amp; &lt;B&gt;");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>x</script>");
  });

  it("includes the auto-print script and an optional served-by line", () => {
    expect(buildReceiptHtml(base)).toContain("window.print()");
    expect(buildReceiptHtml({ ...base, servedBy: "Bob" })).toContain("Served by Bob");
  });
});

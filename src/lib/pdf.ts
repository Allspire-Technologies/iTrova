// jsPDF's built-in Helvetica is Latin-1 only, so currency SYMBOLS like ₦/₵/₦ render as tofu (and
// can mangle nearby digits). For print we format with the ASCII currency CODE instead — "NGN 22,050.00".
export function pdfMoneyFormatter(currency?: string): (n: number) => string {
  const code = (currency || "NGN").toUpperCase();
  try {
    const nf = new Intl.NumberFormat("en-US", { style: "currency", currency: code, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n) => nf.format(Number(n) || 0);
  } catch {
    return (n) => `${code} ${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

// jsPDF (+autotable and its transitive html2canvas/dompurify chunks) is heavy — load it only when
// someone actually exports a PDF, not at app startup (Experience Roadmap · Phase 1).
export async function loadPdf() {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  return { jsPDF, autoTable };
}

export type PdfDocInput = {
  docType: "INVOICE" | "PURCHASE ORDER";
  docNumber: string;
  date: string;
  dueDate?: string | null;
  status?: string;
  business: { name: string; currency?: string; tin?: string | null };
  partyLabel: string; // "Bill to" or "Supplier"
  party: { name: string; phone?: string | null; email?: string | null; address?: string | null };
  items: { description: string; quantity: number; unit_price: number; line_total: number }[];
  subtotal: number;
  discount?: number;
  tax?: number;
  total: number;
  landedCosts?: { label: string; amount: number }[]; // freight/duty/other (PO) — shown below the total
  formatMoney?: (n: number) => string; // ignored for print — amounts use the ASCII currency code (see pdfMoneyFormatter)
  notes?: string | null;
};

export async function buildPdf(input: PdfDocInput) {
  const { jsPDF, autoTable } = await loadPdf();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 40;
  // Always print with the ASCII currency code (symbols break in the built-in PDF font).
  const money = pdfMoneyFormatter(input.business.currency);

  // Header
  doc.setFont("helvetica", "bold").setFontSize(22);
  doc.text(input.docType, M, 56);
  doc.setFont("helvetica", "normal").setFontSize(10);
  doc.text(`#${input.docNumber}`, M, 74);
  if (input.status) {
    doc.setFont("helvetica", "bold");
    doc.text(input.status.toUpperCase(), pageW - M, 56, { align: "right" });
    doc.setFont("helvetica", "normal");
  }

  // Business
  doc.setFontSize(11).setFont("helvetica", "bold");
  doc.text(input.business.name, pageW - M, 74, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9);
  let by = 90;
  if (input.business.tin) { doc.text(`TIN: ${input.business.tin}`, pageW - M, by, { align: "right" }); by += 14; }
  doc.text(`Date: ${input.date}`, pageW - M, by, { align: "right" }); by += 14;
  if (input.dueDate) doc.text(`Due: ${input.dueDate}`, pageW - M, by, { align: "right" });

  // Party block
  doc.setFontSize(10).setFont("helvetica", "bold");
  doc.text(input.partyLabel, M, 120);
  doc.setFont("helvetica", "normal");
  let py = 134;
  doc.text(input.party.name, M, py); py += 14;
  if (input.party.phone) { doc.text(input.party.phone, M, py); py += 14; }
  if (input.party.email) { doc.text(input.party.email, M, py); py += 14; }
  if (input.party.address) { doc.text(String(input.party.address).slice(0, 80), M, py); py += 14; }

  // Items table
  autoTable(doc, {
    startY: Math.max(py + 8, 180),
    head: [["Description", "Qty", "Unit price", "Total"]],
    body: input.items.map((it) => [
      it.description,
      String(it.quantity),
      money(it.unit_price),
      money(it.line_total),
    ]),
    styles: { fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    margin: { left: M, right: M },
  });

  // Totals. When there's VAT the shown subtotal is the NET (total − VAT), so subtotal + VAT = total
  // (prices are typically VAT-inclusive, so the stored subtotal already contains the VAT). The
  // discount is already baked into the total, so it isn't itemised again on a taxed document.
  // @ts-expect-error autoTable adds lastAutoTable
  const endY: number = doc.lastAutoTable.finalY + 20;
  const hasTax = !!input.tax && input.tax > 0;
  const shownSubtotal = hasTax ? input.total - (input.tax as number) : input.subtotal;
  const lx = pageW - M - 200;
  const vx = pageW - M;
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(60);
  let row = endY;
  doc.text("Subtotal", lx, row);
  doc.text(money(shownSubtotal), vx, row, { align: "right" });
  if (!hasTax && input.discount && input.discount > 0) {
    row += 16;
    doc.text("Discount", lx, row);
    doc.text(`-${money(input.discount)}`, vx, row, { align: "right" });
  }
  if (hasTax) {
    row += 16;
    doc.text("VAT", lx, row);
    doc.text(money(input.tax as number), vx, row, { align: "right" });
  }
  // Divider above the grand total for a cleaner finish.
  row += 12;
  doc.setDrawColor(200).setLineWidth(0.5).line(lx, row, vx, row);
  row += 16;
  doc.setFont("helvetica", "bold").setFontSize(12).setTextColor(30);
  doc.text("Total", lx, row);
  doc.text(money(input.total), vx, row, { align: "right" });
  doc.setTextColor(0);

  // Landed costs (freight/duty/other) below the total, with a landed-cost grand total.
  const landed = input.landedCosts?.filter(l => Number(l.amount) > 0) ?? [];
  if (landed.length) {
    const landedSum = landed.reduce((s, l) => s + Number(l.amount), 0);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(90);
    for (const l of landed) {
      row += 14;
      doc.text(l.label, lx, row);
      doc.text(money(Number(l.amount)), vx, row, { align: "right" });
    }
    row += 12;
    doc.setDrawColor(200).setLineWidth(0.5).line(lx, row, vx, row);
    row += 14;
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(30);
    doc.text("Landed cost total", lx, row);
    doc.text(money(input.total + landedSum), vx, row, { align: "right" });
    doc.setTextColor(0);
  }

  if (input.notes) {
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.text("Notes:", M, row + 28);
    doc.text(doc.splitTextToSize(input.notes, pageW - M * 2) as string[], M, row + 42);
  }

  doc.setFontSize(8).setTextColor(120);
  doc.text("Generated by iTrova", M, doc.internal.pageSize.getHeight() - 24);

  return doc;
}

export async function downloadPdf(input: PdfDocInput, filename: string) {
  (await buildPdf(input)).save(filename);
}

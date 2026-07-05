import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, FileDown, Pencil } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useDateFormat } from "@/hooks/useDateFormat";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePageSkeleton } from "@/components/Skeletons";
import {
  getExportInvoice,
  downloadExportInvoicePdf,
  downloadExportInvoiceDocx,
  formatExportMoney,
  lineTotal,
  invoiceTotal,
  totalCartons,
  amountInWords,
  type ExportInvoiceRecord,
} from "@/lib/exportInvoice";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm text-brand-dark whitespace-pre-wrap">{value}</p>
    </div>
  );
}

export default function ExportInvoiceView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { fmtDate } = useDateFormat();
  const [inv, setInv] = useState<ExportInvoiceRecord | null | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    getExportInvoice(id)
      .then((r) => setInv(r))
      .catch((e) => { toast.error(e?.message ?? "Couldn't load the invoice"); setInv(null); });
  }, [id]);

  if (inv === undefined) return <TablePageSkeleton />;
  if (!inv) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/export-invoice")}><ArrowLeft className="size-4" /> Back</Button>
        <p className="text-muted-foreground">Export invoice not found.</p>
      </div>
    );
  }

  const money = (n: number) => formatExportMoney(n, inv.currency);
  const total = invoiceTotal(inv.items);
  const base = inv.invoice_number.replace(/[^\w.-]+/g, "-");

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* min-w-0 chain + break-words: long invoice numbers wrap on phones instead of overflowing. */}
        <div className="flex items-start gap-3 min-w-0">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => navigate("/export-invoice")} aria-label="Back to export invoices"><ArrowLeft className="size-5" /></Button>
          <div className="min-w-0">
            <h1 className="font-display text-2xl lg:text-3xl font-bold text-brand-dark break-words">{inv.invoice_number}</h1>
            <p className="text-muted-foreground text-sm">{fmtDate(inv.invoice_date)}{inv.buyer.name ? ` · ${inv.buyer.name}` : ""}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can("export_invoices", "edit") && <Button variant="ghost" size="sm" onClick={() => navigate(`/export-invoice/${inv.id}/edit`)}><Pencil className="size-4" /> Edit</Button>}
          <Button variant="outline" size="sm" onClick={() => downloadExportInvoicePdf(inv, `${base}.pdf`)}><FileDown className="size-4" /> PDF</Button>
          <Button variant="outline" size="sm" onClick={() => downloadExportInvoiceDocx(inv, `${base}.docx`)}><FileDown className="size-4" /> DOCX</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-3"><CardTitle className="font-display text-lg">Exporter (Seller)</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Company" value={inv.seller.name} />
            <Field label="RC number" value={inv.seller.rc} />
            <Field label="Phone" value={inv.seller.phone} />
            <Field label="Email" value={inv.seller.email} />
            <div className="sm:col-span-2"><Field label="Address" value={inv.seller.address} /></div>
            <Field label="Bank" value={inv.bank.bank_name} />
            <Field label="Account name" value={inv.bank.account_name} />
            <Field label="Account number" value={inv.bank.account_number} />
            <Field label="SWIFT / IBAN" value={inv.bank.swift} />
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-3"><CardTitle className="font-display text-lg">Buyer & details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Buyer" value={inv.buyer.name} />
            <Field label="Buyer country" value={inv.buyer.country} />
            <div className="sm:col-span-2"><Field label="Buyer address" value={inv.buyer.address} /></div>
            <Field label="Invoice number" value={inv.invoice_number} />
            <Field label="Date" value={fmtDate(inv.invoice_date)} />
            <Field label="Country of origin" value={inv.country_of_origin} />
            <Field label="Currency" value={inv.currency} />
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-3"><CardTitle className="font-display text-lg">Products</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>No</TableHead><TableHead>Product Description</TableHead><TableHead>Size</TableHead>
                  <TableHead className="text-right">Units/Box</TableHead><TableHead className="text-right">Boxes</TableHead>
                  <TableHead className="text-right">Unit Price</TableHead><TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.items.map((it, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium text-brand-dark">{it.description}</TableCell>
                    <TableCell>{it.size}</TableCell>
                    <TableCell className="text-right">{it.units_per_box || ""}</TableCell>
                    <TableCell className="text-right">{it.boxes}</TableCell>
                    <TableCell className="text-right">{money(it.unit_price)}</TableCell>
                    <TableCell className="text-right">{money(lineTotal(it))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4 border-t border-border/60 p-4 text-sm">
            <span className="text-muted-foreground">Total cartons <span className="font-medium text-brand-dark">{totalCartons(inv.items)}</span></span>
            <span className="text-muted-foreground">Grand total</span>
            <span className="font-display text-lg font-bold text-brand-dark">{money(total)}</span>
          </div>
          <p className="px-4 pb-4 text-sm text-muted-foreground">{inv.amount_in_words || amountInWords(total, inv.currency)}</p>
        </CardContent>
      </Card>

      {(inv.shipping.mode_of_shipment || inv.shipping.delivery_terms || inv.shipping.packaging || inv.shipping.payment_terms || inv.notes) && (
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-3"><CardTitle className="font-display text-lg">Shipping & notes</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Mode of shipment" value={inv.shipping.mode_of_shipment} />
            <Field label="Delivery terms" value={inv.shipping.delivery_terms} />
            <Field label="Packaging" value={inv.shipping.packaging} />
            <Field label="Payment terms" value={inv.shipping.payment_terms} />
            <div className="sm:col-span-2"><Field label="Notes" value={inv.notes} /></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

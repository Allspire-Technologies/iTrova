import { useCallback, useEffect, useState } from "react";
import { Download, Eye, Pencil, Printer, Trash2, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { downloadPdf } from "@/lib/pdf";
import { buildReceiptHtml } from "@/lib/receipt";
import { discardReviewSale, listQueuedSales, listReviewSales, removeQueuedSale, updateQueuedSale } from "@/lib/offlineStore";
import type { QueuedSale } from "@/lib/offlineTypes";

type Row = QueuedSale & { __review: boolean; reviewReason?: string };
type EditItem = { product_id: string; name: string; quantity: number; unit_price: number };

// Invoices saved offline live in the device queue until they sync. This view lists them and lets the
// user view / print / fully edit (customer + line qty/price + discount) the pending ones.
export function OfflineInvoices() {
  const { business, role } = useAuth();
  const canManage = role === "owner" || role === "manager"; // same rule as the online Invoices page
  const { fmt } = useCurrency();
  const { fmtDate } = useDateFormat();
  const [rows, setRows] = useState<Row[]>([]);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ customerName: "", customerPhone: "", customerEmail: "", notes: "", discount: 0, items: [] as EditItem[] });

  const refresh = useCallback(async () => {
    if (!business) return;
    const [queued, review] = await Promise.all([listQueuedSales(business.id), listReviewSales(business.id)]);
    const merged: Row[] = [
      ...queued.map((s) => ({ ...s, __review: false })),
      ...review.map((s) => ({ ...s, __review: true, reviewReason: s.reviewReason })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setRows(merged);
  }, [business]);

  useEffect(() => { refresh(); }, [refresh]);

  const openEdit = (r: Row) => {
    setEditing(r);
    setForm({
      customerName: r.customerName ?? "",
      customerPhone: r.customerPhone ?? "",
      customerEmail: r.customerEmail ?? "",
      notes: r.notes ?? "",
      discount: r.discount,
      items: r.items.map((i) => ({ product_id: i.product_id, name: i.name, quantity: i.quantity, unit_price: i.unit_price })),
    });
  };

  const editSubtotal = form.items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  const editTotal = Math.max(0, editSubtotal - Number(form.discount || 0));

  const saveEdit = async () => {
    if (!editing) return;
    const items = form.items.filter((i) => Number(i.quantity) > 0);
    if (items.length === 0) return toast.error("Keep at least one item, or delete the invoice.");
    const subtotal = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
    const total = Math.max(0, subtotal - Number(form.discount || 0));
    await updateQueuedSale(editing.saleId, {
      customerName: form.customerName.trim() || "Walk-in Customer",
      customerPhone: form.customerPhone.trim() || null,
      customerEmail: form.customerEmail.trim() || null,
      notes: form.notes.trim() || null,
      items, discount: Number(form.discount || 0), subtotal, total,
    });
    setEditing(null);
    await refresh();
    toast.success("Offline invoice updated.");
  };

  // Print = open a printable receipt window (mirrors the online "Print"). Download = save a PDF.
  const printReceipt = (r: Row) => {
    const html = buildReceiptHtml({
      businessName: business?.name || "",
      docNumber: r.invoiceNumber,
      date: r.createdAt.slice(0, 10),
      customerName: r.customerName || "Walk-in Customer",
      servedBy: null,
      items: r.items.map((i) => ({ description: i.name, quantity: Number(i.quantity), line_total: Number(i.quantity) * Number(i.unit_price) })),
      subtotal: Number(r.subtotal),
      discount: Number(r.discount) || 0,
      total: Number(r.total),
      paid: true,
      formatMoney: fmt,
    });
    const w = window.open("", "_blank", "width=360,height=640");
    if (!w) { toast.error("Allow pop-ups to print the receipt"); return; }
    w.document.write(html);
    w.document.close();
  };

  const download = (r: Row) => {
    downloadPdf({
      docType: "INVOICE",
      docNumber: r.invoiceNumber,
      date: r.createdAt.slice(0, 10),
      dueDate: null,
      status: "paid",
      business: { name: business?.name || "" },
      partyLabel: "Bill to",
      party: { name: r.customerName || "Walk-in Customer", phone: r.customerPhone ?? null, email: r.customerEmail ?? null },
      items: r.items.map((i) => ({ description: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price), line_total: Number(i.quantity) * Number(i.unit_price) })),
      subtotal: Number(r.subtotal), discount: Number(r.discount) || 0, tax: 0, total: Number(r.total),
      formatMoney: fmt,
      notes: r.notes ?? null,
    }, `${r.invoiceNumber}.pdf`);
  };

  const remove = async (r: Row) => {
    if (!window.confirm(`Delete offline invoice ${r.invoiceNumber}? This can't be undone.`)) return;
    if (r.__review) await discardReviewSale(r.saleId);
    else await removeQueuedSale(r.saleId);
    await refresh();
    toast.success("Deleted.");
  };

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark flex items-center gap-2">
            <WifiOff className="size-6 text-warning" /> Invoices (offline)
          </h1>
          <p className="text-muted-foreground mt-1">Invoices saved on this device. They sync from Point of Sale when you{"'"}re back online.</p>
        </div>
      </div>

      <Card className="shadow-card border-border/60">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">No offline invoices on this device.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.saleId} className="border-b border-border/50 hover:bg-secondary/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-brand-dark whitespace-nowrap">{r.invoiceNumber}</td>
                    <td className="px-4 py-3">{r.customerName || "Walk-in Customer"}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">{fmtDate(r.createdAt)}</td>
                    <td className="px-4 py-3 text-right font-display font-semibold text-brand-dark">{fmt(r.total)}</td>
                    <td className="px-4 py-3">
                      {r.__review
                        ? <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">Needs review</Badge>
                        : <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">Pending sync</Badge>}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button variant="ghost" size="icon" aria-label={`View ${r.invoiceNumber}`} onClick={() => setViewing(r)}><Eye className="size-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={`Print ${r.invoiceNumber}`} onClick={() => printReceipt(r)}><Printer className="size-4" /></Button>
                      <Button variant="ghost" size="icon" aria-label={`Download ${r.invoiceNumber}`} onClick={() => download(r)}><Download className="size-4" /></Button>
                      {canManage && !r.__review && <Button variant="ghost" size="icon" aria-label={`Edit ${r.invoiceNumber}`} onClick={() => openEdit(r)}><Pencil className="size-4" /></Button>}
                      {canManage && <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${r.invoiceNumber}`} onClick={() => remove(r)}><Trash2 className="size-4" /></Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* View */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent>
          {viewing && (
            <>
              <DialogHeader><DialogTitle className="font-display">{viewing.invoiceNumber}</DialogTitle></DialogHeader>
              <div className="text-sm space-y-1">
                <div className="font-medium text-brand-dark">{viewing.customerName || "Walk-in Customer"}</div>
                {viewing.customerPhone && <div className="text-muted-foreground">{viewing.customerPhone}</div>}
                {viewing.customerEmail && <div className="text-muted-foreground">{viewing.customerEmail}</div>}
              </div>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase text-muted-foreground border-b"><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
                  <tbody>
                    {viewing.items.map((it, i) => (
                      <tr key={i} className="border-t"><td className="px-3 py-2">{it.name}</td><td className="px-3 py-2 text-right">{it.quantity}</td><td className="px-3 py-2 text-right">{fmt(Number(it.quantity) * Number(it.unit_price))}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmt(viewing.subtotal)}</span></div>
                {viewing.discount > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>−{fmt(viewing.discount)}</span></div>}
                <div className="flex justify-between font-semibold text-brand-dark"><span>Total</span><span>{fmt(viewing.total)}</span></div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => printReceipt(viewing)}><Printer className="size-4" /> Print</Button>
                <Button onClick={() => download(viewing)}><Download className="size-4" /> Download</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit (full: customer + line qty/price + discount) */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="font-display">Edit {editing?.invoiceNumber}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1"><Label>Customer</Label><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} placeholder="Walk-in Customer" /></div>
              <div className="space-y-1"><Label>Phone</Label><Input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} /></div>
              <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })} /></div>
            </div>
            <div className="space-y-2">
              <Label>Items</Label>
              {form.items.map((it, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{it.name}</span>
                  <Input type="number" min="0" step="1" className="w-20" value={it.quantity} aria-label={`Quantity for ${it.name}`}
                    onChange={(e) => setForm({ ...form, items: form.items.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x) })} />
                  <Input type="number" min="0" step="0.01" className="w-28" value={it.unit_price} aria-label={`Price for ${it.name}`}
                    onChange={(e) => setForm({ ...form, items: form.items.map((x, i) => i === idx ? { ...x, unit_price: Number(e.target.value) } : x) })} />
                  <Button variant="ghost" size="icon" aria-label={`Remove ${it.name}`} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}><Trash2 className="size-4" /></Button>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Discount</Label><Input type="number" min="0" step="0.01" value={form.discount} onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })} /></div>
              <div className="self-end text-right">
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="font-display text-lg font-bold text-brand-dark">{fmt(editTotal)}</div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="brand" onClick={saveEdit}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

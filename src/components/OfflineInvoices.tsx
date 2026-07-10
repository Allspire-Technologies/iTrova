import { useCallback, useEffect, useState } from "react";
import { Download, Eye, Pencil, Plus, Printer, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DatePicker from "@/components/DatePicker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import SearchableSelect from "@/components/SearchableSelect";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { downloadPdf } from "@/lib/pdf";
import { buildReceiptHtml } from "@/lib/receipt";
import { invoiceFallbackNumber } from "@/lib/invoiceNumber";
import {
  applyLocalPaymentDelta, discardPaymentReview, discardReviewSale, enqueueInvoice, enqueuePayment,
  listQueuedInvoices, listQueuedSales, listQueuedPayments, listPaymentReviews, listReviewSales,
  newOfflineSaleId, putCachedInvoice, readCachedInvoices, removeQueuedSale, updateQueuedSale,
} from "@/lib/offlineStore";
import type { CachedInvoice, QueuedInvoice, QueuedPayment, QueuedSale, ReviewPayment } from "@/lib/offlineTypes";

type Row = QueuedSale & { __review: boolean; reviewReason?: string };
type EditItem = { product_id: string; name: string; quantity: number; unit_price: number };
type NewLine = { description: string; quantity: number; unit_price: number };

const PAYMENT_METHODS = ["cash", "bank transfer", "card", "mobile money", "other"];
const EMPTY_NEW_INVOICE = { customerName: "", customerPhone: "", customerEmail: "", dueDate: "", notes: "", lines: [{ description: "", quantity: 1, unit_price: 0 }] as NewLine[] };

// Invoices saved offline live in the device queue until they sync. This view lists them and lets the
// user view / print / fully edit (customer + line qty/price + discount) the pending ones.
export function OfflineInvoices() {
  const { business, can } = useAuth();
  // Same permission rules as the online Invoices page (RBAC).
  const canCreate = can("invoices", "create");
  const canPay = can("invoices", "record_payment");
  const canEditInv = can("invoices", "edit");
  const canDeleteInv = can("invoices", "delete");
  const { fmt } = useCurrency();
  const { fmtDate } = useDateFormat();
  const [rows, setRows] = useState<Row[]>([]);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ customerName: "", customerPhone: "", customerEmail: "", notes: "", discount: 0, items: [] as EditItem[] });
  const [cachedInvoices, setCachedInvoices] = useState<CachedInvoice[]>([]);
  const [queuedInvoices, setQueuedInvoices] = useState<QueuedInvoice[]>([]);
  const [queuedPayments, setQueuedPayments] = useState<QueuedPayment[]>([]);
  const [paymentReviews, setPaymentReviews] = useState<ReviewPayment[]>([]);
  const [paying, setPaying] = useState<CachedInvoice | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", method: "cash", note: "" });
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState(EMPTY_NEW_INVOICE);

  const refresh = useCallback(async () => {
    if (!business) return;
    const [queued, review, invs, qInvs, pays, payReviews] = await Promise.all([
      listQueuedSales(business.id), listReviewSales(business.id), readCachedInvoices(business.id),
      listQueuedInvoices(business.id), listQueuedPayments(business.id), listPaymentReviews(business.id),
    ]);
    const merged: Row[] = [
      ...queued.map((s) => ({ ...s, __review: false })),
      ...review.map((s) => ({ ...s, __review: true, reviewReason: s.reviewReason })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    setRows(merged);
    setCachedInvoices(invs);
    setQueuedInvoices(qInvs);
    setQueuedPayments(pays);
    setPaymentReviews(payReviews);
  }, [business]);

  useEffect(() => { refresh(); }, [refresh]);

  const balanceOf = (inv: CachedInvoice) => Number(inv.total) - Number(inv.amount_paid);
  const awaiting = cachedInvoices.filter((i) => balanceOf(i) > 0).sort((a, b) => a.invoice_number.localeCompare(b.invoice_number));
  const queuedFor = (invoiceId: string) => queuedPayments.filter((p) => p.invoiceId === invoiceId).length;

  const openPay = (inv: CachedInvoice) => {
    setPaying(inv);
    const bal = balanceOf(inv);
    setPayForm({ amount: bal > 0 ? String(bal) : "", method: "cash", note: "" });
  };

  const recordOfflinePayment = async () => {
    if (!paying || !business) return;
    const amt = Number(payForm.amount);
    const bal = balanceOf(paying);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (amt > bal + 0.001) return toast.error(`Amount exceeds the balance of ${fmt(bal)}`);
    const payment: QueuedPayment = {
      paymentId: newOfflineSaleId(),
      invoiceId: paying.id,
      invoiceNumber: paying.invoice_number,
      businessId: business.id,
      amount: amt,
      method: payForm.method,
      note: payForm.note.trim() || null,
      createdAt: new Date().toISOString(),
      status: "pending",
      attempts: 0,
    };
    await enqueuePayment(payment);
    await applyLocalPaymentDelta(paying.id, amt); // optimistic: shrink the cached balance
    setPaying(null);
    await refresh();
    toast.success("Deposit saved — it'll sync to the invoice when you're back online.");
  };

  const discardPayment = async (paymentId: string) => {
    if (!window.confirm("Discard this offline deposit? This can't be undone.")) return;
    await discardPaymentReview(paymentId);
    await refresh();
    toast.success("Deposit discarded.");
  };

  // ---- create a manual invoice offline -------------------------------------
  const newSubtotal = newForm.lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0);
  const updateNewLine = (idx: number, patch: Partial<NewLine>) =>
    setNewForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  const addNewLine = () => setNewForm((f) => ({ ...f, lines: [...f.lines, { description: "", quantity: 1, unit_price: 0 }] }));
  const removeNewLine = (idx: number) =>
    setNewForm((f) => ({ ...f, lines: f.lines.length === 1 ? f.lines : f.lines.filter((_, i) => i !== idx) }));

  const createOfflineInvoice = async () => {
    if (!business) return;
    if (!newForm.customerName.trim()) return toast.error("Customer name is required");
    const lines = newForm.lines.filter((l) => l.description.trim() && Number(l.quantity) > 0);
    if (lines.length === 0) return toast.error("Add at least one line item");
    const subtotal = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0);
    const invoiceId = newOfflineSaleId();
    const invoiceNumber = invoiceFallbackNumber();
    const queued: QueuedInvoice = {
      invoiceId, businessId: business.id, invoiceNumber,
      customerName: newForm.customerName.trim(),
      customerPhone: newForm.customerPhone.trim() || null,
      customerEmail: newForm.customerEmail.trim() || null,
      dueDate: newForm.dueDate || null,
      notes: newForm.notes.trim() || null,
      items: lines.map((l) => ({ description: l.description.trim(), quantity: Number(l.quantity), unit_price: Number(l.unit_price) })),
      subtotal, total: subtotal, createdAt: new Date().toISOString(), status: "pending", attempts: 0,
    };
    await enqueueInvoice(queued);
    // Mirror it into the cache (as a local row) so a deposit can be recorded against it right away.
    await putCachedInvoice({
      id: invoiceId, business_id: business.id, invoice_number: invoiceNumber,
      customer_name: queued.customerName, total: subtotal, amount_paid: 0, status: "issued",
      cachedAt: Date.now(), local: true,
    });
    setCreating(false);
    setNewForm(EMPTY_NEW_INVOICE);
    await refresh();
    toast.success("Invoice saved offline — it'll sync when you're back online.");
  };

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
      tax: Number(r.tax) || 0,
      tin: business?.tin ?? null,
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
      business: { name: business?.name || "", currency: business?.currency, tin: business?.tin },
      partyLabel: "Bill to",
      party: { name: r.customerName || "Walk-in Customer", phone: r.customerPhone ?? null, email: r.customerEmail ?? null },
      items: r.items.map((i) => ({ description: i.name, quantity: Number(i.quantity), unit_price: Number(i.unit_price), line_total: Number(i.quantity) * Number(i.unit_price) })),
      subtotal: Number(r.subtotal), discount: Number(r.discount) || 0, tax: Number(r.tax) || 0, total: Number(r.total),
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
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Invoices (offline)</h1>
          <p className="text-muted-foreground mt-1">Create invoices and record deposits on this device. They sync when you{"'"}re back online.</p>
        </div>
        {canCreate && <Button variant="brand" onClick={() => { setNewForm(EMPTY_NEW_INVOICE); setCreating(true); }}><Plus className="size-4" /> New invoice</Button>}
      </div>

      {/* Awaiting payment — record deposits offline against already-synced invoices */}
      {(awaiting.length > 0 || queuedPayments.length > 0 || paymentReviews.length > 0) && (
        <Card className="shadow-card border-border/60 overflow-hidden p-0">
          <div className="px-4 py-3 border-b border-border bg-secondary/30">
            <h2 className="font-display font-semibold text-brand-dark">Awaiting payment</h2>
            <p className="text-xs text-muted-foreground">Record a deposit now; it syncs to the invoice when you{"'"}re back online.</p>
          </div>
          {(queuedInvoices.length > 0 || queuedPayments.length > 0) && (
            <div className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-200">
              {[
                queuedInvoices.length > 0 ? `${queuedInvoices.length} invoice${queuedInvoices.length === 1 ? "" : "s"}` : null,
                queuedPayments.length > 0 ? `${queuedPayments.length} deposit${queuedPayments.length === 1 ? "" : "s"}` : null,
              ].filter(Boolean).join(" and ")} saved on this device, waiting to sync.
            </div>
          )}
          {awaiting.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No invoices were cached for offline payment.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {awaiting.map((inv) => {
                    const queued = queuedFor(inv.id);
                    return (
                      <tr key={inv.id} className="border-b border-border/50 hover:bg-secondary/40 transition-colors">
                        <td className="px-4 py-3 font-medium text-brand-dark whitespace-nowrap">{inv.invoice_number}</td>
                        <td className="px-4 py-3">{inv.customer_name}</td>
                        <td className="px-4 py-3 text-right font-display font-semibold text-brand-dark">{fmt(balanceOf(inv))}</td>
                        <td className="px-4 py-3">
                          {inv.status === "partial"
                            ? <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">Partial</Badge>
                            : <Badge variant="outline">Issued</Badge>}
                          {inv.local && <Badge variant="outline" className="ml-2 border-amber-300 bg-amber-50 text-amber-700">Not synced</Badge>}
                          {queued > 0 && <span className="ml-2 text-xs text-muted-foreground">{queued} queued</span>}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {canPay && <Button variant="ghost" size="sm" aria-label={`Record payment for ${inv.invoice_number}`} onClick={() => openPay(inv)}><Wallet className="size-4" /> Payment</Button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {paymentReviews.length > 0 && (
            <div className="px-4 py-3 border-t border-border space-y-2">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Deposits needing review</div>
              {paymentReviews.map((p) => (
                <div key={p.paymentId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0"><span className="font-medium">{fmt(p.amount)}</span> · {p.invoiceNumber} · <span className="text-red-600">{p.reviewReason}</span></span>
                  {canPay && <Button variant="ghost" size="icon" className="shrink-0" aria-label={`Discard deposit for ${p.invoiceNumber}`} onClick={() => discardPayment(p.paymentId)}><Trash2 className="size-4" /></Button>}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

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
                      {canEditInv && !r.__review && <Button variant="ghost" size="icon" aria-label={`Edit ${r.invoiceNumber}`} onClick={() => openEdit(r)}><Pencil className="size-4" /></Button>}
                      {canDeleteInv && <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" aria-label={`Delete ${r.invoiceNumber}`} onClick={() => remove(r)}><Trash2 className="size-4" /></Button>}
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
        <DialogContent variant="wide">
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
        <DialogContent variant="wide">
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

      {/* Record payment (offline) */}
      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent className="max-w-md">
          {paying && (
            <>
              <DialogHeader><DialogTitle className="font-display">Record payment · {paying.invoice_number}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="rounded-lg border border-border p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span>{fmt(paying.total)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Paid so far</span><span>{fmt(paying.amount_paid)}</span></div>
                  <div className="flex justify-between font-medium"><span>Balance</span><span>{fmt(balanceOf(paying))}</span></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label>Amount *</Label><Input type="number" min="0" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></div>
                  <div className="space-y-1">
                    <Label>Method</Label>
                    <SearchableSelect value={payForm.method} onValueChange={(v) => setPayForm({ ...payForm, method: v })} className="w-full"
                      options={PAYMENT_METHODS.map((m) => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))} />
                  </div>
                </div>
                <div className="space-y-1"><Label>Note</Label><Input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} placeholder="Optional" /></div>
                <p className="text-xs text-muted-foreground">Saved on this device and synced to the invoice when you{"'"}re back online.</p>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPaying(null)}>Cancel</Button>
                <Button variant="brand" onClick={recordOfflinePayment}>Save deposit</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* New invoice (offline) */}
      <Dialog open={creating} onOpenChange={(o) => !o && setCreating(false)}>
        <DialogContent variant="wide" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">New invoice (offline)</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1"><Label>Customer *</Label><Input value={newForm.customerName} onChange={(e) => setNewForm({ ...newForm, customerName: e.target.value })} placeholder="Walk-in Customer" /></div>
              <div className="space-y-1"><Label>Phone</Label><Input value={newForm.customerPhone} onChange={(e) => setNewForm({ ...newForm, customerPhone: e.target.value })} /></div>
              <div className="space-y-1"><Label>Email</Label><Input type="email" value={newForm.customerEmail} onChange={(e) => setNewForm({ ...newForm, customerEmail: e.target.value })} /></div>
            </div>
            <div className="space-y-2">
              <Label>Line items</Label>
              {newForm.lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-6" placeholder="Description" value={l.description} onChange={(e) => updateNewLine(idx, { description: e.target.value })} />
                  <Input className="col-span-2" type="number" min="0" placeholder="Qty" value={l.quantity} aria-label="Quantity" onChange={(e) => updateNewLine(idx, { quantity: Number(e.target.value) })} />
                  <Input className="col-span-3" type="number" min="0" placeholder="Unit price" value={l.unit_price || ""} aria-label="Unit price" onChange={(e) => updateNewLine(idx, { unit_price: Number(e.target.value) })} />
                  <Button variant="ghost" size="icon" className="col-span-1" aria-label="Remove line" onClick={() => removeNewLine(idx)}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addNewLine}><Plus className="size-4" /> Add line</Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Due date</Label><DatePicker value={newForm.dueDate} onChange={(v) => setNewForm({ ...newForm, dueDate: v })} clearable placeholder="Select date" /></div>
              <div className="self-end text-right">
                <div className="text-xs text-muted-foreground">Total</div>
                <div className="font-display text-lg font-bold text-brand-dark">{fmt(newSubtotal)}</div>
              </div>
            </div>
            <div className="space-y-1"><Label>Notes</Label><Textarea rows={2} value={newForm.notes} onChange={(e) => setNewForm({ ...newForm, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="brand" onClick={createOfflineInvoice}>Save invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

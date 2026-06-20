import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import SearchableSelect from "@/components/SearchableSelect";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Plus, Search, FileText, Trash2, Download, Eye, MessageCircle, Pencil, Mail, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import { downloadPdf } from "@/lib/pdf";
import { toCsv, downloadCsv } from "@/lib/csv";
import Paginator, { usePagination } from "@/components/Paginator";
import { TablePageSkeleton } from "@/components/Skeletons";
import { getLimit, isAtLimit, limitMessage } from "@/lib/planLimits";
import { useCurrency } from "@/hooks/useCurrency";

type Invoice = {
  id: string; invoice_number: string; customer_name: string; customer_phone: string | null;
  customer_email: string | null; status: string; subtotal: number; tax: number; total: number;
  discount_amount: number;
  issue_date: string; due_date: string | null; notes: string | null; sale_id: string | null;
};
type Item = { id?: string; description: string; quantity: number; unit_price: number; line_total: number };

const STATUSES = ["draft", "issued", "paid", "void"];

export default function Invoices() {
  const { business } = useAuth();
  const { fmt } = useCurrency();
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Invoice | null>(null);
  const [viewItems, setViewItems] = useState<Item[]>([]);
  const [form, setForm] = useState({ customer_name: "", customer_phone: "", customer_email: "", due_date: "", notes: "" });
  const [lines, setLines] = useState<Item[]>([{ description: "", quantity: 1, unit_price: 0, line_total: 0 }]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [pending, setPending] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  type SortCol = "number" | "customer" | "date" | "total" | "status";
  const [sortCol, setSortCol] = useState<SortCol>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const load = async () => {
    const { data, error } = await supabase.from("invoices").select("*").order("created_at", { ascending: false });
    if (error) return toast.error(error.message);
    setItems((data as Invoice[]) || []);
    setLoading(false);
  };
  useEffect(() => { if (business) load(); }, [business]);

  const openAdd = () => {
    setEditing(null);
    setForm({ customer_name: "", customer_phone: "", customer_email: "", due_date: "", notes: "" });
    setLines([{ description: "", quantity: 1, unit_price: 0, line_total: 0 }]);
    setOpen(true);
  };

  const openEdit = async (inv: Invoice) => {
    setEditing(inv);
    setForm({
      customer_name: inv.customer_name,
      customer_phone: inv.customer_phone || "",
      customer_email: inv.customer_email || "",
      due_date: inv.due_date || "",
      notes: inv.notes || "",
    });
    const { data } = await supabase.from("invoice_items").select("*").eq("invoice_id", inv.id);
    setLines((data as Item[]) || [{ description: "", quantity: 1, unit_price: 0, line_total: 0 }]);
    setOpen(true);
  };

  const filtered = items
    .filter(i =>
      (statusFilter === "all" || i.status === statusFilter) &&
      (!dateFrom || i.issue_date >= dateFrom) &&
      (!dateTo || i.issue_date <= dateTo) &&
      (q === "" || i.invoice_number.toLowerCase().includes(q.toLowerCase()) || i.customer_name.toLowerCase().includes(q.toLowerCase()))
    )
    .sort((a, b) => {
      let cmp = 0;
      if (sortCol === "number")        cmp = a.invoice_number.localeCompare(b.invoice_number);
      else if (sortCol === "customer") cmp = a.customer_name.localeCompare(b.customer_name);
      else if (sortCol === "date")     cmp = a.issue_date.localeCompare(b.issue_date);
      else if (sortCol === "total")    cmp = Number(a.total) - Number(b.total);
      else if (sortCol === "status")   cmp = a.status.localeCompare(b.status);
      return sortDir === "asc" ? cmp : -cmp;
    });

  const { paged, page, setPage, pageSize, setPageSize, pageCount, total } = usePagination(filtered, 20);

  const tier = business?.subscription_tier;
  const invoiceLimit = getLimit(tier, "invoices");
  const atInvoiceLimit = isAtLimit(items.length, tier, "invoices");

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortCol(col); setSortDir("asc"); }
    setPage(1);
  };

  const updateLine = (idx: number, patch: Partial<Item>) => {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const merged = { ...l, ...patch };
      merged.line_total = Number(merged.quantity) * Number(merged.unit_price);
      return merged;
    }));
  };
  const addLine = () => setLines(prev => [...prev, { description: "", quantity: 1, unit_price: 0, line_total: 0 }]);
  const removeLine = (idx: number) => setLines(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));

  const subtotal = lines.reduce((s, l) => s + (l.line_total || 0), 0);

  const save = async () => {
    if (!business) return;
    if (!editing && isAtLimit(items.length, business.subscription_tier, "invoices")) {
      toast.error(limitMessage("invoices"));
      return;
    }
    if (!form.customer_name.trim()) return toast.error("Customer name is required");
    if (lines.some(l => !l.description.trim())) return toast.error("Every line needs a description");
    setBusy(true);

    const itemPayload = (invId: string) => lines.map(l => ({
      invoice_id: invId, description: l.description,
      quantity: l.quantity, unit_price: l.unit_price, line_total: l.line_total,
    }));

    if (editing) {
      const { error } = await supabase.from("invoices").update({
        customer_name: form.customer_name,
        customer_phone: form.customer_phone || null,
        customer_email: form.customer_email || null,
        due_date: form.due_date || null,
        notes: form.notes || null,
        subtotal, total: subtotal,
      }).eq("id", editing.id);
      if (error) { setBusy(false); return toast.error(error.message); }
      await supabase.from("invoice_items").delete().eq("invoice_id", editing.id);
      const { error: e2 } = await supabase.from("invoice_items").insert(itemPayload(editing.id));
      setBusy(false);
      if (e2) return toast.error(e2.message);
      toast.success(`Invoice ${editing.invoice_number} updated`);
    } else {
      const { data: numData } = await supabase.rpc("next_doc_number" as any, {
        _business_id: business.id, _prefix: "INV", _table: "invoices", _col: "invoice_number",
      });
      const invoice_number: string = (numData as string) || `INV-${Date.now().toString().slice(-6)}`;
      const { data: inv, error } = await supabase.from("invoices").insert({
        business_id: business.id, invoice_number,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone || null,
        customer_email: form.customer_email || null,
        due_date: form.due_date || null,
        notes: form.notes || null,
        subtotal, total: subtotal, status: "issued",
      }).select().single();
      if (error) { setBusy(false); return toast.error(error.message); }
      const { error: e2 } = await supabase.from("invoice_items").insert(itemPayload(inv!.id));
      setBusy(false);
      if (e2) return toast.error(e2.message);
      toast.success(`Invoice ${invoice_number} created`);
    }

    setOpen(false);
    setEditing(null);
    setForm({ customer_name: "", customer_phone: "", customer_email: "", due_date: "", notes: "" });
    setLines([{ description: "", quantity: 1, unit_price: 0, line_total: 0 }]);
    load();
  };

  const remove = (i: Invoice) => {
    setPending({
      title: `Delete ${i.invoice_number}?`,
      description: "This invoice and all its line items will be permanently deleted.",
      onConfirm: async () => {
        const { error } = await supabase.from("invoices").delete().eq("id", i.id);
        if (error) return toast.error(error.message);
        toast.success("Invoice deleted"); load();
      },
    });
  };

  const changeStatus = async (i: Invoice, status: string) => {
    const { error } = await supabase.from("invoices").update({ status }).eq("id", i.id);
    if (error) return toast.error(error.message);
    setItems(prev => prev.map(x => x.id === i.id ? { ...x, status } : x));
  };

  const openView = async (i: Invoice) => {
    setViewing(i);
    const { data } = await supabase.from("invoice_items").select("*").eq("invoice_id", i.id);
    let resolved = (data as Item[]) || [];

    // Trigger-created invoices may have no invoice_items (trigger fired before sale_items
    // were inserted). Fall back to sale_items when the invoice links to a sale.
    if (resolved.length === 0 && i.sale_id) {
      const { data: siData } = await supabase
        .from("sale_items")
        .select("quantity,unit_price,products(name)")
        .eq("sale_id", i.sale_id);
      if (siData && siData.length > 0) {
        resolved = (siData as any[]).map(si => ({
          description: si.products?.name || "Item",
          quantity: Number(si.quantity),
          unit_price: Number(si.unit_price),
          line_total: Number(si.quantity) * Number(si.unit_price),
        }));
        // Backfill invoice_items so future views load instantly
        supabase.from("invoice_items").insert(
          resolved.map(r => ({ invoice_id: i.id, ...r }))
        ).then(({ error }) => {
          if (error) console.warn("invoice_items backfill:", error.message);
        });
      }
    }

    setViewItems(resolved);
  };

  const exportPdf = async (i: Invoice) => {
    const { data } = await supabase.from("invoice_items").select("*").eq("invoice_id", i.id);
    downloadPdf({
      docType: "INVOICE", docNumber: i.invoice_number, date: i.issue_date,
      dueDate: i.due_date, status: i.status,
      business: { name: business?.name || "" },
      partyLabel: "Bill to",
      party: { name: i.customer_name, phone: i.customer_phone, email: i.customer_email },
      items: (data as Item[]) || [],
      subtotal: Number(i.subtotal), tax: Number(i.tax), total: Number(i.total),
      notes: i.notes,
    }, `${i.invoice_number}.pdf`);
  };

  const isOverdue = (inv: Invoice) =>
    inv.status === "issued" && !!inv.due_date && new Date(inv.due_date) < new Date();

  const overdueDays = (inv: Invoice) =>
    Math.floor((Date.now() - new Date(inv.due_date!).getTime()) / 86_400_000);

  const shareWa = (inv: Invoice) => {
    const text = [
      `*Invoice ${inv.invoice_number}*`,
      `From: ${business?.name || ""}`,
      `Date: ${inv.issue_date}`,
      inv.due_date ? `Due: ${inv.due_date}` : null,
      `Amount: ${fmt(inv.total)}`,
      inv.notes || null,
    ].filter(Boolean).join("\n");
    const phone = inv.customer_phone?.replace(/[^\d+]/g, "").replace(/^\+/, "") || "";
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const statusColor = (s: string) =>
    s === "paid" ? "default" : s === "issued" ? "secondary" : s === "void" ? "destructive" : "outline";

  const exportCsv = () => {
    const rows = filtered.map(i => ({
      invoice_number: i.invoice_number,
      customer_name: i.customer_name,
      customer_phone: i.customer_phone || "",
      customer_email: i.customer_email || "",
      issue_date: i.issue_date,
      due_date: i.due_date || "",
      status: i.status,
      subtotal: Number(i.subtotal),
      tax: Number(i.tax),
      total: Number(i.total),
      notes: i.notes || "",
    }));
    downloadCsv(
      `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, ["invoice_number", "customer_name", "customer_phone", "customer_email", "issue_date", "due_date", "status", "subtotal", "tax", "total", "notes"]),
    );
    toast.success(`Exported ${rows.length} invoice${rows.length === 1 ? "" : "s"}`);
  };

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? sortDir === "asc" ? <ArrowUp className="size-3 ml-1" /> : <ArrowDown className="size-3 ml-1" />
      : <ArrowUpDown className="size-3 ml-1 opacity-30" />;

  if (loading) return <TablePageSkeleton />;

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Invoices</h1>
          <p className="text-sm text-muted-foreground">Sales receipts and customer invoices</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="size-4 mr-1" /> Export CSV
          </Button>
          {invoiceLimit !== null && items.length >= Math.floor(invoiceLimit * 0.8) && (
            <span className={`self-center text-xs font-medium ${atInvoiceLimit ? "text-destructive" : "text-amber-600"}`}>
              {items.length} / {invoiceLimit}
            </span>
          )}
          <Button onClick={openAdd} disabled={atInvoiceLimit} title={atInvoiceLimit ? limitMessage("invoices") : undefined}><Plus className="size-4 mr-1" /> New invoice</Button>
        </div>
      </div>

      <Card className="p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search by number or customer" className="pl-9" />
        </div>
        <SearchableSelect
          value={statusFilter}
          onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
          className="w-40"
          options={[
            { value: "all", label: "All statuses" },
            ...STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
          ]}
        />
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="w-36" title="From date" />
          <span className="text-muted-foreground text-sm shrink-0">to</span>
          <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="w-36" title="To date" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <FileText className="size-10 mx-auto mb-3 opacity-40" />
            No invoices yet. Sales recorded in POS will appear here automatically.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">
                    <button onClick={() => toggleSort("number")} className="flex items-center hover:text-foreground transition-colors">Number <SortIcon col="number" /></button>
                  </th>
                  <th className="px-4 py-3">
                    <button onClick={() => toggleSort("customer")} className="flex items-center hover:text-foreground transition-colors">Customer <SortIcon col="customer" /></button>
                  </th>
                  <th className="px-4 py-3">
                    <button onClick={() => toggleSort("date")} className="flex items-center hover:text-foreground transition-colors">Date <SortIcon col="date" /></button>
                  </th>
                  <th className="px-4 py-3 text-right normal-case">Original amount</th>
                  <th className="px-4 py-3 text-right normal-case">Discount</th>
                  <th className="px-4 py-3 text-right">
                    <button onClick={() => toggleSort("total")} className="flex items-center ml-auto hover:text-foreground transition-colors">Total <SortIcon col="total" /></button>
                  </th>
                  <th className="px-4 py-3">
                    <button onClick={() => toggleSort("status")} className="flex items-center hover:text-foreground transition-colors">Status <SortIcon col="status" /></button>
                  </th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {paged.map(i => (
                  <tr key={i.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono">{i.invoice_number}</td>
                    <td className="px-4 py-3">{i.customer_name}</td>
                    <td className="px-4 py-3">{i.issue_date}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{fmt(i.subtotal)}</td>
                    <td className="px-4 py-3 text-right">
                      {Number(i.discount_amount) > 0
                        ? <span className="text-destructive font-medium">-{fmt(i.discount_amount)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(i.total)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <SearchableSelect
                          value={i.status}
                          onValueChange={(v) => changeStatus(i, v)}
                          className="w-28 h-8"
                          options={STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
                        />
                        {isOverdue(i) && <Badge variant="destructive" className="text-xs shrink-0">Overdue</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" onClick={() => openView(i)}><Eye className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(i)}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => exportPdf(i)}><Download className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(i)}><Trash2 className="size-4 text-destructive" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Paginator page={page} pageCount={pageCount} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </div>
        )}
      </Card>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? `Edit ${editing.invoice_number}` : "New invoice"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Customer name *</Label><Input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={form.customer_phone} onChange={e => setForm({ ...form, customer_phone: e.target.value })} /></div>
              <div><Label>Email</Label><Input value={form.customer_email} onChange={e => setForm({ ...form, customer_email: e.target.value })} /></div>
              <div><Label>Due date</Label><Input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} /></div>
            </div>
            <div className="space-y-2">
              <Label>Line items</Label>
              {lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Input className="col-span-6" placeholder="Description" value={l.description} onChange={e => updateLine(idx, { description: e.target.value })} />
                  <Input className="col-span-2" type="number" min={0} placeholder="Qty" value={l.quantity} onChange={e => updateLine(idx, { quantity: Number(e.target.value) })} />
                  <Input className="col-span-3" type="number" min={0} placeholder="Unit price" value={l.unit_price || ""} onChange={e => updateLine(idx, { unit_price: Number(e.target.value) })} />
                  <Button variant="ghost" size="icon" className="col-span-1" onClick={() => removeLine(idx)}><Trash2 className="size-4" /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addLine}><Plus className="size-4 mr-1" /> Add line</Button>
            </div>
            <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="text-right text-lg font-semibold">Total: {fmt(subtotal)}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : (editing ? "Save changes" : "Create invoice")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-xl">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 flex-wrap">
                  {viewing.invoice_number}
                  <Badge variant={statusColor(viewing.status) as any}>{viewing.status}</Badge>
                  {isOverdue(viewing) && (
                    <Badge variant="destructive">{overdueDays(viewing)} day{overdueDays(viewing) === 1 ? "" : "s"} overdue</Badge>
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div><span className="text-muted-foreground">Customer:</span> {viewing.customer_name}</div>
                <div><span className="text-muted-foreground">Date:</span> {viewing.issue_date}</div>
                {viewing.due_date && <div><span className="text-muted-foreground">Due:</span> {viewing.due_date}</div>}
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Total</th></tr></thead>
                    <tbody>
                      {viewItems.map((it, i) => (
                        <tr key={i} className="border-t"><td className="px-3 py-2">{it.description}</td><td className="px-3 py-2 text-right">{it.quantity}</td><td className="px-3 py-2 text-right">{fmt(it.line_total)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-1 text-right">
                  <div className="text-sm text-muted-foreground">Subtotal: {fmt(viewing.subtotal)}</div>
                  <div className={`text-sm ${Number(viewing.discount_amount) > 0 ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                    Discount: {Number(viewing.discount_amount) > 0 ? `-${fmt(viewing.discount_amount)}` : "—"}
                  </div>
                  <div className="font-semibold">Total: {fmt(viewing.total)}</div>
                </div>
                {viewing.notes && <div className="text-muted-foreground">{viewing.notes}</div>}
              </div>
              <DialogFooter className="flex-wrap gap-2">
                <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
                <Button variant="outline" disabled={!viewing.customer_email} onClick={() => {
                  const subject = encodeURIComponent(`Invoice ${viewing.invoice_number} from ${business?.name || ""}`);
                  const body = encodeURIComponent([
                    `Dear ${viewing.customer_name},`,
                    ``,
                    `Invoice #: ${viewing.invoice_number}`,
                    `Date: ${viewing.issue_date}`,
                    viewing.due_date ? `Due: ${viewing.due_date}` : "",
                    `Amount: ${fmt(viewing.total)}`,
                    viewing.notes ? `\nNotes: ${viewing.notes}` : "",
                    ``,
                    `Thank you,`,
                    business?.name || "",
                  ].filter(Boolean).join("\n"));
                  window.open(`mailto:${viewing.customer_email}?subject=${subject}&body=${body}`);
                }}><Mail className="size-4 mr-1" /> Email</Button>
                <Button variant="outline" onClick={() => shareWa(viewing)}><MessageCircle className="size-4 mr-1" /> WhatsApp</Button>
                <Button onClick={() => exportPdf(viewing)}><Download className="size-4 mr-1" /> Download PDF</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pending}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.title ?? ""}
        description={pending?.description}
        onConfirm={pending?.onConfirm ?? (() => {})}
      />
    </div>
  );
}

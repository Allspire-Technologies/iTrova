import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Plus, Search, FileText, Trash2, Download, Eye, MessageCircle, Pencil, Mail, ArrowUp, ArrowDown, ArrowUpDown, Printer, MoreHorizontal, Wallet, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { downloadPdf } from "@/lib/pdf";
import { buildReceiptHtml } from "@/lib/receipt";
import { toCsv, downloadCsv } from "@/lib/csv";
import { invoiceFallbackNumber } from "@/lib/invoiceNumber";
import { buildInvoiceMessage, toWaNumber, isValidWaNumber, waLink } from "@/lib/whatsapp";
import WhatsAppShareDialog from "@/components/WhatsAppShareDialog";
import Paginator, { usePagination } from "@/components/Paginator";
import { TablePageSkeleton } from "@/components/Skeletons";
import { getLimit, isAtLimit, limitMessage } from "@/lib/planLimits";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { INVOICE_STATUS_FILTERS as STATUS_FILTERS, statusOptionsFor, isOverdue, overdueDays } from "@/lib/invoiceStatus";
import { useOnline } from "@/contexts/OnlineContext";
import { OfflineInvoices } from "@/components/OfflineInvoices";
import { cacheInvoices, countPendingInvoices, countPendingPayments } from "@/lib/offlineStore";
import { drainInvoicing } from "@/lib/offlineSync";
import type { CachedInvoice } from "@/lib/offlineTypes";

type Invoice = {
  id: string; invoice_number: string; customer_name: string; customer_phone: string | null;
  customer_email: string | null; status: string; subtotal: number; tax: number; total: number;
  discount_amount: number; amount_paid: number;
  issue_date: string; due_date: string | null; notes: string | null; sale_id: string | null;
  created_by: string | null;
};
type Item = { id?: string; description: string; quantity: number; unit_price: number; line_total: number };
type Payment = { id: string; amount: number; method: string; note: string | null; created_at: string; created_by: string | null };

const PAYMENT_METHODS = ["cash", "bank transfer", "card", "mobile money", "other"];

/** A manual invoice still owing money — eligible for a deposit. POS invoices are paid at sale time. */
function canTakePayment(i: { sale_id: string | null; status: string }): boolean {
  return !i.sale_id && (i.status === "issued" || i.status === "partial");
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" disabled={disabled} aria-label={label} onClick={onClick}>{children}</Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function Invoices() {
  const { business, user, role, hasModule } = useAuth();
  const { online } = useOnline();
  const canManage = role === "owner" || role === "manager";
  const { fmt } = useCurrency();
  const { timezone } = useDateFormat();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(() => searchParams.get("q") || "");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Invoice | null>(null);
  const [viewItems, setViewItems] = useState<Item[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", method: "cash", note: "" });
  const [waShare, setWaShare] = useState<{ message: string } | null>(null);
  const [form, setForm] = useState({ customer_name: "", customer_phone: "", customer_email: "", due_date: "", notes: "" });
  const [lines, setLines] = useState<Item[]>([{ description: "", quantity: 1, unit_price: 0, line_total: 0 }]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [pending, setPending] = useState<{ title: string; description: string; confirmLabel?: string; variant?: "destructive" | "default"; onConfirm: () => void } | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  type SortCol = "number" | "customer" | "date" | "total" | "status";
  const [sortCol, setSortCol] = useState<SortCol>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [creators, setCreators] = useState<Record<string, string>>({});
  const [creatorFilter, setCreatorFilter] = useState("all");
  const [offlinePending, setOfflinePending] = useState(0); // invoices + deposits captured offline, awaiting sync
  const [syncingDeposits, setSyncingDeposits] = useState(false);
  const countOfflineWork = (businessId: string) =>
    Promise.all([countPendingInvoices(businessId), countPendingPayments(businessId)]).then(([a, b]) => a + b);

  const load = async () => {
    const [{ data, error }, { data: profs }] = await Promise.all([
      supabase.from("invoices").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, owner_name"),
    ]);
    if (error) return toast.error(error.message);
    const rows = (data as Invoice[]) || [];
    setItems(rows);
    const map: Record<string, string> = {};
    for (const p of (profs as { id: string; owner_name: string | null }[] | null) ?? []) {
      if (p.owner_name) map[p.id] = p.owner_name;
    }
    setCreators(map);
    setLoading(false);
    // Snapshot manual, still-owing invoices so deposits can be recorded offline.
    if (business) {
      const eligible: CachedInvoice[] = rows
        .filter(i => !i.sale_id && (i.status === "issued" || i.status === "partial"))
        .map(i => ({
          id: i.id, business_id: business.id, invoice_number: i.invoice_number,
          customer_name: i.customer_name, total: Number(i.total), amount_paid: Number(i.amount_paid),
          status: i.status, cachedAt: Date.now(),
        }));
      cacheInvoices(business.id, eligible).catch(() => {/* offline storage optional */});
      countOfflineWork(business.id).then(setOfflinePending).catch(() => {/* optional */});
    }
  };
  useEffect(() => { if (business && online) load(); }, [business, online]);

  // Sync offline-created invoices first, then the deposits that reference them.
  const syncOfflineWork = async () => {
    if (!business) return;
    setSyncingDeposits(true);
    try {
      const outcomes = await drainInvoicing(business.id);
      const review = outcomes.filter(o => o.result === "review").length;
      const transient = outcomes.some(o => o.result === "transient");
      if (review > 0) toast.warning(`${review} offline deposit${review === 1 ? "" : "s"} need review — the balance changed before they synced.`);
      if (transient) toast.error("Some offline items couldn't sync — please try again.");
      if (!review && !transient) toast.success("Offline invoices and deposits synced.");
      await load();
    } finally {
      setSyncingDeposits(false);
    }
  };

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
      (creatorFilter === "all" || (creatorFilter === "none" ? !i.created_by : i.created_by === creatorFilter)) &&
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

  // Sync search from the URL on same-route navigation (deep-links while already mounted).
  useEffect(() => {
    const qp = searchParams.get("q");
    if (qp !== null) { setQ(qp); setPage(1); }
  }, [searchParams, setPage]);

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
      const { error: logErr } = await supabase.rpc("log_invoice_edit" as any, { _invoice_id: editing.id, _summary: `Invoice ${editing.invoice_number} edited` });
      if (logErr) console.error("log_invoice_edit failed:", logErr);
      toast.success(`Invoice ${editing.invoice_number} updated`);
    } else {
      const { data: numData } = await supabase.rpc("next_invoice_number" as any, { _business_id: business.id });
      const invoice_number: string = (numData as string) || invoiceFallbackNumber();
      const { data: inv, error } = await supabase.from("invoices").insert({
        business_id: business.id, invoice_number,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone || null,
        customer_email: form.customer_email || null,
        due_date: form.due_date || null,
        notes: form.notes || null,
        subtotal, total: subtotal, status: "issued",
        created_by: user?.id ?? null,
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
    if (status === i.status) return;
    const { error } = await supabase.from("invoices").update({ status }).eq("id", i.id);
    if (error) return toast.error(error.message);
    setItems(prev => prev.map(x => x.id === i.id ? { ...x, status } : x));
    const { error: logErr } = await supabase.rpc("log_invoice_edit" as any, { _invoice_id: i.id, _summary: `Invoice ${i.invoice_number} marked ${status}` });
    if (logErr) console.error("log_invoice_edit failed:", logErr);
  };

  // Voiding is final and reverses the sale, so confirm it first.
  const requestStatusChange = (i: Invoice, status: string) => {
    if (status === i.status) return;
    if (status === "void") {
      setPending({
        title: `Void ${i.invoice_number}?`,
        description: i.sale_id
          ? "Voiding is final. The sale will be reversed — its revenue removed and the sold stock returned to inventory. The invoice can no longer be edited."
          : "Voiding is final. The invoice will be marked void and can no longer be edited.",
        confirmLabel: "Void invoice",
        onConfirm: () => changeStatus(i, "void"),
      });
      return;
    }
    if (status === "paid") {
      setPending({
        title: `Mark ${i.invoice_number} as paid?`,
        description: "Once marked paid, the only further change allowed is voiding it.",
        confirmLabel: "Mark as paid",
        variant: "default",
        onConfirm: () => changeStatus(i, "paid"),
      });
      return;
    }
    changeStatus(i, status);
  };

  const loadPayments = async (invoiceId: string) => {
    const { data } = await supabase
      .from("invoice_payments")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true });
    setPayments((data as Payment[]) || []);
  };

  const openPay = (i: Invoice) => {
    setPaying(i);
    const balance = Number(i.total) - Number(i.amount_paid);
    setPayForm({ amount: balance > 0 ? String(balance) : "", method: "cash", note: "" });
    loadPayments(i.id);
  };

  const recordPayment = async () => {
    if (!paying) return;
    const amt = Number(payForm.amount);
    const balance = Number(paying.total) - Number(paying.amount_paid);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (amt > balance + 0.001) return toast.error(`Amount exceeds the balance of ${fmt(balance)}`);
    setBusy(true);
    const { data, error } = await supabase.rpc("record_invoice_payment" as any, {
      _payment_id: crypto.randomUUID(),
      _invoice_id: paying.id,
      _amount: amt,
      _method: payForm.method,
      _note: payForm.note || null,
    });
    setBusy(false);
    if (error) {
      if (error.message?.includes("NEEDS_REVIEW")) return toast.error("The balance changed — reopen the invoice and try again");
      return toast.error(error.message);
    }
    const res = (data as { invoice_status?: string }) || {};
    toast.success(res.invoice_status === "paid" ? `${paying.invoice_number} fully paid` : "Payment recorded");
    setPaying(null);
    load();
  };

  const removePayment = (p: Payment) => {
    setPending({
      title: "Remove this payment?",
      description: `${fmt(p.amount)} will be removed and the balance recalculated.`,
      confirmLabel: "Remove payment",
      variant: "destructive",
      onConfirm: async () => {
        const { error } = await supabase.rpc("delete_invoice_payment" as any, { _payment_id: p.id });
        if (error) return toast.error(error.message);
        toast.success("Payment removed");
        const inv = paying ?? viewing;
        if (inv) loadPayments(inv.id);
        load();
      },
    });
  };

  const openView = async (i: Invoice) => {
    setViewing(i);
    loadPayments(i.id);
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
      subtotal: Number(i.subtotal), discount: Number(i.discount_amount) || 0, tax: Number(i.tax), total: Number(i.total),
      formatMoney: fmt,
      notes: i.notes,
    }, `${i.invoice_number}.pdf`);
  };

  const printReceipt = async (i: Invoice) => {
    const { data } = await supabase.from("invoice_items").select("*").eq("invoice_id", i.id);
    const items = ((data as Item[]) || []).map(it => ({
      description: it.description,
      quantity: Number(it.quantity),
      line_total: Number(it.line_total),
    }));
    const html = buildReceiptHtml({
      businessName: business?.name || "",
      docNumber: i.invoice_number,
      date: i.issue_date,
      customerName: i.customer_name,
      servedBy: i.created_by ? creators[i.created_by] : null,
      items,
      subtotal: Number(i.subtotal),
      discount: Number(i.discount_amount) || 0,
      total: Number(i.total),
      paid: i.status === "paid",
      formatMoney: fmt,
    });
    const w = window.open("", "_blank", "width=360,height=640");
    if (!w) { toast.error("Allow pop-ups to print the receipt"); return; }
    w.document.write(html);
    w.document.close();
  };

  const todayInTz = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

  const shareWa = (inv: Invoice) => {
    const message = buildInvoiceMessage({
      businessName: business?.name || "",
      invoiceNumber: inv.invoice_number,
      customerName: inv.customer_name,
      issueDate: inv.issue_date,
      dueDate: inv.due_date,
      status: inv.status,
      items: viewItems.map(it => ({ description: it.description, quantity: Number(it.quantity), lineTotal: Number(it.line_total) })),
      subtotal: Number(inv.subtotal),
      discount: Number(inv.discount_amount),
      total: Number(inv.total),
      notes: inv.notes,
      fmt,
    });
    const phone = toWaNumber(inv.customer_phone || "");
    if (isValidWaNumber(phone)) window.open(waLink(phone, message), "_blank");
    else setWaShare({ message });
  };

  const statusColor = (s: string) =>
    s === "paid" ? "default" : s === "issued" ? "secondary" : s === "void" ? "destructive" : "outline";

  const StatusBadge = ({ s }: { s: string }) =>
    s === "partial"
      ? <Badge className="bg-amber-500 hover:bg-amber-500 text-white">Partial</Badge>
      : <Badge variant={statusColor(s) as any}>{s}</Badge>;

  const balanceOf = (i: Invoice) => Number(i.total) - Number(i.amount_paid);

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

  const creatorName = (id: string | null) => (id ? (creators[id] || "Unknown") : "—");
  const creatorOptions = [
    { value: "all", label: "All creators" },
    ...Array.from(new Set(items.map(i => i.created_by).filter(Boolean) as string[]))
      .map(id => ({ value: id, label: creators[id] || "Unknown" }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    ...(items.some(i => !i.created_by) ? [{ value: "none", label: "No creator" }] : []),
  ];

  if (!online) return <OfflineInvoices />;
  if (loading) return <TablePageSkeleton />;

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Invoices</h1>
          <p className="text-muted-foreground mt-1">Sales receipts and customer invoices</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {offlinePending > 0 && (
            <Button variant="outline" onClick={syncOfflineWork} disabled={syncingDeposits} title="Sync invoices and deposits saved while offline">
              <RefreshCw className={`size-4 mr-1 ${syncingDeposits ? "animate-spin" : ""}`} /> {syncingDeposits ? "Syncing…" : `Sync now (${offlinePending})`}
            </Button>
          )}
          {canManage && hasModule("csv_export") && (
            <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
              <Download className="size-4 mr-1" /> Export CSV
            </Button>
          )}
          {invoiceLimit !== null && items.length >= Math.floor(invoiceLimit * 0.8) && (
            <span className={`self-center text-xs font-medium ${atInvoiceLimit ? "text-destructive" : "text-amber-600"}`}>
              {items.length} / {invoiceLimit}
            </span>
          )}
          <Button onClick={openAdd} disabled={atInvoiceLimit} title={atInvoiceLimit ? limitMessage("invoices") : undefined}><Plus className="size-4 mr-1" /> New invoice</Button>
        </div>
      </div>

      {offlinePending > 0 && (
        <Card className="p-4 border-amber-300 bg-amber-50">
          <div className="text-sm text-amber-800">
            {offlinePending} offline {offlinePending === 1 ? "item is" : "items are"} waiting to sync (invoices and deposits saved on this device). Use <span className="font-medium">Sync now</span> above.
          </div>
        </Card>
      )}

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
            ...STATUS_FILTERS.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
          ]}
        />
        <SearchableSelect
          value={creatorFilter}
          onValueChange={(v) => { setCreatorFilter(v); setPage(1); }}
          className="w-44"
          options={creatorOptions}
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
                  <th className="px-4 py-3 normal-case">Created by</th>
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
                    <td className="px-4 py-3 font-mono">
                      <div className="flex items-center gap-2">
                        {i.invoice_number}
                        {i.sale_id && <Badge variant="secondary" className="text-[10px] uppercase tracking-wider px-1.5 py-0">POS</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3">{i.customer_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{creatorName(i.created_by)}</td>
                    <td className="px-4 py-3">{i.issue_date}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{fmt(i.subtotal)}</td>
                    <td className="px-4 py-3 text-right">
                      {Number(i.discount_amount) > 0
                        ? <span className="text-destructive font-medium">-{fmt(i.discount_amount)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(i.total)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          {canManage ? (
                            <SearchableSelect
                              value={i.status}
                              onValueChange={(v) => requestStatusChange(i, v)}
                              disabled={i.status === "void"}
                              className="w-28 h-8"
                              options={statusOptionsFor(i).map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
                            />
                          ) : (
                            <StatusBadge s={i.status} />
                          )}
                          {isOverdue(i, todayInTz) && <Badge variant="destructive" className="text-xs shrink-0">Overdue</Badge>}
                        </div>
                        {i.status === "partial" && (
                          <span className="text-xs text-muted-foreground">{fmt(balanceOf(i))} left</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <IconBtn label="View" onClick={() => openView(i)}><Eye className="size-4" /></IconBtn>
                        {canManage && canTakePayment(i) && <IconBtn label="Record payment" onClick={() => openPay(i)}><Wallet className="size-4" /></IconBtn>}
                        {canManage && <IconBtn label={i.status === "void" ? "Voided invoices can't be edited" : "Edit"} disabled={i.status === "void"} onClick={() => openEdit(i)}><Pencil className="size-4" /></IconBtn>}
                        {i.status === "paid" && <IconBtn label="Print" onClick={() => printReceipt(i)}><Printer className="size-4" /></IconBtn>}
                        <DropdownMenu>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" aria-label="More actions"><MoreHorizontal className="size-4" /></Button>
                              </DropdownMenuTrigger>
                            </TooltipTrigger>
                            <TooltipContent>More actions</TooltipContent>
                          </Tooltip>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => exportPdf(i)}><Download className="size-4 mr-2" /> Download</DropdownMenuItem>
                            {canManage && <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => remove(i)}><Trash2 className="size-4 mr-2" /> Delete</DropdownMenuItem>}
                          </DropdownMenuContent>
                        </DropdownMenu>
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
              {editing?.sale_id && (
                <p className="text-xs text-muted-foreground -mt-1">
                  This invoice came from a POS sale — description and unit price are locked to the price at sale time. Only quantity can be adjusted.
                </p>
              )}
              {lines.map((l, idx) => {
                const posLocked = !!editing?.sale_id;
                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <Input className="col-span-6" placeholder="Description" value={l.description} disabled={posLocked} onChange={e => updateLine(idx, { description: e.target.value })} />
                    <Input className="col-span-2" type="number" min={0} placeholder="Qty" value={l.quantity} onChange={e => updateLine(idx, { quantity: Number(e.target.value) })} />
                    <Input className="col-span-3" type="number" min={0} placeholder="Unit price" value={l.unit_price || ""} disabled={posLocked} onChange={e => updateLine(idx, { unit_price: Number(e.target.value) })} />
                    <Button variant="ghost" size="icon" className="col-span-1" disabled={posLocked} onClick={() => removeLine(idx)}><Trash2 className="size-4" /></Button>
                  </div>
                );
              })}
              {!editing?.sale_id && (
                <Button variant="outline" size="sm" onClick={addLine}><Plus className="size-4 mr-1" /> Add line</Button>
              )}
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
                  <StatusBadge s={viewing.status} />
                  {isOverdue(viewing, todayInTz) && (
                    <Badge variant="destructive">{overdueDays(viewing.due_date!, todayInTz)} day{overdueDays(viewing.due_date!, todayInTz) === 1 ? "" : "s"} overdue</Badge>
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div><span className="text-muted-foreground">Customer:</span> {viewing.customer_name}</div>
                <div><span className="text-muted-foreground">Created by:</span> {viewing.created_by ? (creators[viewing.created_by] || "Unknown") : "—"}{viewing.sale_id ? " (POS)" : ""}</div>
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
                  {Number(viewing.amount_paid) > 0 && (
                    <>
                      <div className="text-sm text-emerald-600">Paid: {fmt(viewing.amount_paid)}</div>
                      {balanceOf(viewing) > 0 && <div className="text-sm font-medium">Balance: {fmt(balanceOf(viewing))}</div>}
                    </>
                  )}
                </div>
                {payments.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Payments</div>
                    {payments.map(p => (
                      <div key={p.id} className="flex items-center justify-between gap-2 text-sm border-b py-1 last:border-0">
                        <div className="min-w-0">
                          <span className="font-medium">{fmt(p.amount)}</span>
                          <span className="text-muted-foreground"> · {p.method} · {p.created_at.slice(0, 10)}</span>
                          {p.note && <span className="text-muted-foreground"> · {p.note}</span>}
                        </div>
                        {canManage && viewing.status === "partial" && (
                          <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="Remove payment" onClick={() => removePayment(p)}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {viewing.notes && <div className="text-muted-foreground">{viewing.notes}</div>}
              </div>
              <DialogFooter className="flex-wrap gap-2">
                {canManage && canTakePayment(viewing) && (
                  <Button variant="outline" className="mr-auto" onClick={() => { const inv = viewing; setViewing(null); openPay(inv); }}>
                    <Wallet className="size-4 mr-1" /> Record payment
                  </Button>
                )}
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
                {viewing.status === "paid" && <Button variant="outline" onClick={() => printReceipt(viewing)}><Printer className="size-4 mr-1" /> Print</Button>}
                <Button onClick={() => exportPdf(viewing)}><Download className="size-4 mr-1" /> Download</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Record payment dialog */}
      <Dialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent className="max-w-md">
          {paying && (
            <>
              <DialogHeader><DialogTitle>Record payment · {paying.invoice_number}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="rounded-lg border p-3 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span>{fmt(paying.total)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Paid so far</span><span>{fmt(paying.amount_paid)}</span></div>
                  <div className="flex justify-between font-medium"><span>Balance</span><span>{fmt(balanceOf(paying))}</span></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Amount *</Label>
                    <Input type="number" min={0} value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} />
                  </div>
                  <div>
                    <Label>Method</Label>
                    <SearchableSelect
                      value={payForm.method}
                      onValueChange={(v) => setPayForm({ ...payForm, method: v })}
                      className="w-full"
                      options={PAYMENT_METHODS.map(m => ({ value: m, label: m.charAt(0).toUpperCase() + m.slice(1) }))}
                    />
                  </div>
                </div>
                <div><Label>Note</Label><Input value={payForm.note} onChange={e => setPayForm({ ...payForm, note: e.target.value })} placeholder="Optional" /></div>
                {payments.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Previous payments</div>
                    {payments.map(p => (
                      <div key={p.id} className="flex items-center justify-between gap-2 text-sm border-b py-1 last:border-0">
                        <div className="min-w-0"><span className="font-medium">{fmt(p.amount)}</span><span className="text-muted-foreground"> · {p.method} · {p.created_at.slice(0, 10)}</span></div>
                        <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="Remove payment" onClick={() => removePayment(p)}><Trash2 className="size-3.5" /></Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPaying(null)}>Cancel</Button>
                <Button onClick={recordPayment} disabled={busy}>{busy ? "Saving…" : "Record payment"}</Button>
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
        confirmLabel={pending?.confirmLabel}
        variant={pending?.variant}
        onConfirm={pending?.onConfirm ?? (() => {})}
      />

      <WhatsAppShareDialog
        open={!!waShare}
        onOpenChange={(o) => !o && setWaShare(null)}
        message={waShare?.message ?? ""}
        recipientLabel="Customer"
      />
    </div>
  );
}

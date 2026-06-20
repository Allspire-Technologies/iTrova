import { useEffect, useRef, useState } from "react";
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
import { Plus, Search, ClipboardList, Trash2, Download, Upload, Eye, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { toast } from "sonner";
import { downloadPdf } from "@/lib/pdf";
import { toCsv, downloadCsv, parseCsv, readFileText } from "@/lib/csv";
import Paginator, { usePagination } from "@/components/Paginator";
import { TablePageSkeleton } from "@/components/Skeletons";
import { getLimit, isAtLimit, limitMessage } from "@/lib/planLimits";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";

type PO = {
  id: string; po_number: string; supplier_id: string | null; status: string;
  expected_date: string | null; total_amount: number; notes: string | null; created_at: string;
};
type Supplier = { id: string; name: string; phone: string | null; email: string | null; address: string | null };
type RawMat = { id: string; name: string; unit: string; cost_per_unit: number };
type Product = { id: string; name: string; unit: string | null; cost_price: number };
type Item = { id?: string; product_id: string | null; raw_material_id: string | null; description: string; quantity: number; unit_cost: number; line_total: number };

const STATUSES = ["draft", "sent", "received", "cancelled"];
type SortCol = "po_number" | "created_at" | "supplier" | "expected_date" | "total_amount" | "status";

export default function PurchaseOrders() {
  const { business } = useAuth();
  const { fmt } = useCurrency();
  const { fmtDate } = useDateFormat();
  const [items, setItems] = useState<PO[]>([]);
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [materials, setMaterials] = useState<RawMat[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<PO | null>(null);
  const [viewItems, setViewItems] = useState<Item[]>([]);
  const [form, setForm] = useState({ supplier_id: "", expected_date: "", notes: "" });
  const [lines, setLines] = useState<Item[]>([{ product_id: null, raw_material_id: null, description: "", quantity: 1, unit_cost: 0, line_total: 0 }]);
  const [pending, setPending] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const [{ data: pos }, { data: sup }, { data: mat }, { data: prod }] = await Promise.all([
      supabase.from("purchase_orders").select("*").order("created_at", { ascending: false }),
      supabase.from("suppliers").select("id, name, phone, email, address"),
      supabase.from("raw_materials").select("id, name, unit, cost_per_unit"),
      supabase.from("products").select("id, name, unit, cost_price").order("name"),
    ]);
    setItems((pos as PO[]) || []);
    setSuppliers((sup as Supplier[]) || []);
    setMaterials((mat as RawMat[]) || []);
    setProducts((prod as Product[]) || []);
    setLoading(false);
  };
  useEffect(() => { if (business) load(); }, [business]);

  const filtered = items
    .filter(i =>
      (statusFilter === "all" || i.status === statusFilter) &&
      (q === "" || i.po_number.toLowerCase().includes(q.toLowerCase())) &&
      (dateFrom === "" || i.created_at.slice(0, 10) >= dateFrom) &&
      (dateTo === "" || i.created_at.slice(0, 10) <= dateTo)
    )
    .sort((a, b) => {
      let av: string | number = "";
      let bv: string | number = "";
      if (sortCol === "po_number") { av = a.po_number; bv = b.po_number; }
      else if (sortCol === "created_at") { av = a.created_at; bv = b.created_at; }
      else if (sortCol === "supplier") {
        av = suppliers.find(s => s.id === a.supplier_id)?.name ?? "";
        bv = suppliers.find(s => s.id === b.supplier_id)?.name ?? "";
      }
      else if (sortCol === "expected_date") { av = a.expected_date ?? ""; bv = b.expected_date ?? ""; }
      else if (sortCol === "total_amount") { av = Number(a.total_amount); bv = Number(b.total_amount); }
      else if (sortCol === "status") { av = a.status; bv = b.status; }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  const { paged, page, setPage, pageSize, setPageSize, pageCount, total } = usePagination(filtered, 20);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
    setPage(1);
  };

  const tier = business?.subscription_tier;
  const poLimit = getLimit(tier, "purchaseOrders");
  const atPoLimit = isAtLimit(items.length, tier, "purchaseOrders");

  if (loading) return <TablePageSkeleton />;

  function SortIcon({ col }: { col: SortCol }) {
    if (sortCol !== col) return <ArrowUpDown className="size-3 ml-1 opacity-30 inline" />;
    return sortDir === "asc"
      ? <ArrowUp className="size-3 ml-1 inline" />
      : <ArrowDown className="size-3 ml-1 inline" />;
  }

  const updateLine = (idx: number, patch: Partial<Item>) => {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx) return l;
      const merged = { ...l, ...patch };
      merged.line_total = Number(merged.quantity) * Number(merged.unit_cost);
      return merged;
    }));
  };
  // A single line can be sourced from an Inventory product, a Raw material, or a custom entry.
  // Values are encoded as "product:<id>" / "material:<id>" / "_custom".
  const sourceValue = (l: Item) =>
    l.product_id ? `product:${l.product_id}` : l.raw_material_id ? `material:${l.raw_material_id}` : "_custom";
  const sourceOptions = [
    { value: "_custom", label: "Custom item (enter manually)" },
    ...products.map(p => ({ value: `product:${p.id}`, label: `Inventory · ${p.name}` })),
    ...materials.map(m => ({ value: `material:${m.id}`, label: `Raw material · ${m.name}` })),
  ];
  const pickSource = (idx: number, value: string) => {
    if (value === "_custom") {
      updateLine(idx, { product_id: null, raw_material_id: null });
      return;
    }
    const [kind, id] = value.split(":");
    if (kind === "product") {
      const p = products.find(x => x.id === id);
      if (!p) return;
      updateLine(idx, { product_id: id, raw_material_id: null, description: p.unit ? `${p.name} (${p.unit})` : p.name, unit_cost: Number(p.cost_price) });
    } else {
      const m = materials.find(x => x.id === id);
      if (!m) return;
      updateLine(idx, { raw_material_id: id, product_id: null, description: `${m.name} (${m.unit})`, unit_cost: Number(m.cost_per_unit) });
    }
  };
  const addLine = () => setLines(prev => [...prev, { product_id: null, raw_material_id: null, description: "", quantity: 1, unit_cost: 0, line_total: 0 }]);
  const removeLine = (idx: number) => setLines(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));

  const subtotal = lines.reduce((s, l) => s + (l.line_total || 0), 0);

  const create = async () => {
    if (!business) return;
    if (isAtLimit(items.length, business.subscription_tier, "purchaseOrders")) {
      toast.error(limitMessage("purchaseOrders"));
      return;
    }
    if (lines.some(l => !l.description.trim())) return toast.error("Every line needs a description");
    setBusy(true);
    const { data: numData } = await supabase.rpc("next_doc_number" as any, {
      _business_id: business.id, _prefix: "PO", _table: "purchase_orders", _col: "po_number"
    });
    const po_number: string = (numData as string) || `PO-${Date.now().toString().slice(-6)}`;
    const { data: po, error } = await supabase.from("purchase_orders").insert({
      business_id: business.id, po_number,
      supplier_id: form.supplier_id || null,
      expected_date: form.expected_date || null,
      notes: form.notes || null,
      total_amount: subtotal, status: "draft",
    }).select().single();
    if (error) { setBusy(false); return toast.error(error.message); }
    const payload = lines.map(l => ({
      purchase_order_id: po!.id, raw_material_id: l.raw_material_id, product_id: l.product_id,
      description: l.description, quantity: l.quantity, unit_cost: l.unit_cost, line_total: l.line_total,
    }));
    const { error: e2 } = await supabase.from("purchase_order_items").insert(payload);
    setBusy(false);
    if (e2) return toast.error(e2.message);
    toast.success(`Purchase order ${po_number} created`);
    setOpen(false);
    setForm({ supplier_id: "", expected_date: "", notes: "" });
    setLines([{ product_id: null, raw_material_id: null, description: "", quantity: 1, unit_cost: 0, line_total: 0 }]);
    load();
  };

  const changeStatus = async (i: PO, status: string) => {
    const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", i.id);
    if (error) return toast.error(error.message);
    if (status === "received") toast.success("PO received — stock updated");
    load();
  };

  const remove = (i: PO) => {
    setPending({
      title: `Delete ${i.po_number}?`,
      description: "This purchase order and all its line items will be permanently deleted.",
      onConfirm: async () => {
        const { error } = await supabase.from("purchase_orders").delete().eq("id", i.id);
        if (error) return toast.error(error.message);
        toast.success("Deleted"); load();
      },
    });
  };

  const openView = async (i: PO) => {
    setViewing(i);
    const { data } = await supabase.from("purchase_order_items").select("*").eq("purchase_order_id", i.id);
    setViewItems((data as Item[]) || []);
  };

  const exportPdf = async (i: PO) => {
    const { data } = await supabase.from("purchase_order_items").select("*").eq("purchase_order_id", i.id);
    const sup = suppliers.find(s => s.id === i.supplier_id);
    downloadPdf({
      docType: "PURCHASE ORDER", docNumber: i.po_number, date: i.created_at.slice(0, 10),
      dueDate: i.expected_date, status: i.status,
      business: { name: business?.name || "" },
      partyLabel: "Supplier",
      party: { name: sup?.name || "—", phone: sup?.phone, email: sup?.email, address: sup?.address },
      items: ((data as Item[]) || []).map(d => ({
        description: d.description, quantity: Number(d.quantity), unit_price: Number(d.unit_cost), line_total: Number(d.line_total),
      })),
      subtotal: Number(i.total_amount), total: Number(i.total_amount),
      notes: i.notes,
    }, `${i.po_number}.pdf`);
  };

  const downloadTemplate = () => {
    const headers = ["supplier_name", "expected_date", "notes", "description", "quantity", "unit_cost"];
    const example = ["Olu Farms Ltd", "2026-07-15", "First batch order", "Wheat Flour (50kg bag)", "10", "8500"];
    downloadCsv("purchase-orders-template.csv", [headers.join(","), example.join(",")].join("\n"));
    toast.success("Template downloaded");
  };

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const rows = filtered.map(i => ({
      po_number: i.po_number,
      supplier: suppliers.find(s => s.id === i.supplier_id)?.name || "",
      status: i.status,
      expected_date: i.expected_date || "",
      created_date: i.created_at.slice(0, 10),
      total_amount: i.total_amount,
      notes: i.notes || "",
    }));
    downloadCsv(
      `purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(rows, ["po_number", "supplier", "status", "expected_date", "created_date", "total_amount", "notes"])
    );
    toast.success(`Exported ${rows.length} purchase order${rows.length === 1 ? "" : "s"}`);
  };

  const importCsv = async (file: File) => {
    if (!business) return;
    if (isAtLimit(items.length, business.subscription_tier, "purchaseOrders")) {
      toast.error(limitMessage("purchaseOrders"));
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    try {
      const text = await readFileText(file);
      const rows = parseCsv(text);
      const valid = rows.filter(r => r.description?.trim());
      if (valid.length === 0) return toast.error("No valid rows. Required column: description");
      let created = 0;
      for (const r of valid) {
        const sup = r.supplier_name
          ? suppliers.find(s => s.name.toLowerCase() === r.supplier_name.toLowerCase())
          : null;
        const { data: numData } = await supabase.rpc("next_doc_number" as any, {
          _business_id: business.id, _prefix: "PO", _table: "purchase_orders", _col: "po_number",
        });
        const po_number: string = (numData as string) || `PO-${Date.now().toString().slice(-6)}`;
        const qty = Math.max(1, Number(r.quantity) || 1);
        const cost = Number(r.unit_cost) || 0;
        const line_total = qty * cost;
        const { data: po, error } = await supabase.from("purchase_orders").insert({
          business_id: business.id, po_number,
          supplier_id: sup?.id || null,
          expected_date: r.expected_date || null,
          notes: r.notes || null,
          total_amount: line_total, status: "draft",
        }).select().single();
        if (error || !po) continue;
        await supabase.from("purchase_order_items").insert({
          purchase_order_id: po.id, raw_material_id: null,
          description: r.description.trim(), quantity: qty, unit_cost: cost, line_total,
        });
        created++;
      }
      if (created > 0) { toast.success(`Imported ${created} purchase order${created === 1 ? "" : "s"}`); load(); }
      else toast.error("No orders could be imported");
    } catch (e: any) {
      toast.error(e.message || "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const statusColor = (s: string) =>
    s === "received" ? "default" : s === "sent" ? "secondary" : s === "cancelled" ? "destructive" : "outline";

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Purchase Orders</h1>
          <p className="text-sm text-muted-foreground">Orders to suppliers — mark as received to add stock</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Button variant="outline" onClick={downloadTemplate}><Download className="size-4" /> CSV Template</Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={atPoLimit} title={atPoLimit ? limitMessage("purchaseOrders") : undefined}><Upload className="size-4" /> Import CSV</Button>
          <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}><Download className="size-4" /> Export CSV</Button>
          {poLimit !== null && items.length >= Math.floor(poLimit * 0.8) && (
            <span className={`self-center text-xs font-medium ${atPoLimit ? "text-destructive" : "text-amber-600"}`}>
              {items.length} / {poLimit}
            </span>
          )}
          <Button onClick={() => { if (atPoLimit) { toast.error(limitMessage("purchaseOrders")); return; } setOpen(true); }} disabled={atPoLimit} title={atPoLimit ? limitMessage("purchaseOrders") : undefined}><Plus className="size-4 mr-1" /> New PO</Button>
        </div>
      </div>

      <Card className="p-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search by PO number" className="pl-9" />
        </div>
        <SearchableSelect
          value={statusFilter}
          onValueChange={v => { setStatusFilter(v); setPage(1); }}
          className="w-40"
          options={[
            { value: "all", label: "All statuses" },
            ...STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
          ]}
        />
        <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="w-36" title="Created from" />
        <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="w-36" title="Created to" />
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <ClipboardList className="size-10 mx-auto mb-3 opacity-40" />
            No purchase orders yet.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    {(["po_number", "created_at", "supplier", "expected_date", "total_amount", "status"] as SortCol[]).map((col, idx) => {
                      const labels: Record<SortCol, string> = {
                        po_number: "Number", created_at: "Date", supplier: "Supplier",
                        expected_date: "Expected", total_amount: "Total", status: "Status",
                      };
                      return (
                        <th key={col} className={`px-4 py-3 font-medium ${idx === 4 ? "text-right" : ""}`}>
                          <button onClick={() => toggleSort(col)} className={`flex items-center gap-0.5 hover:text-foreground ${idx === 4 ? "ml-auto" : ""}`}>
                            {labels[col]}<SortIcon col={col} />
                          </button>
                        </th>
                      );
                    })}
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map(i => (
                    <tr key={i.id} className="border-t hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono">{i.po_number}</td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(i.created_at)}</td>
                      <td className="px-4 py-3">{suppliers.find(s => s.id === i.supplier_id)?.name || "—"}</td>
                      <td className="px-4 py-3">{i.expected_date || "—"}</td>
                      <td className="px-4 py-3 text-right font-medium">{fmt(i.total_amount)}</td>
                      <td className="px-4 py-3">
                        <SearchableSelect
                          value={i.status}
                          onValueChange={(v) => changeStatus(i, v)}
                          className="w-28 h-8"
                          options={STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <Button variant="ghost" size="icon" onClick={() => openView(i)}><Eye className="size-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => exportPdf(i)}><Download className="size-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => remove(i)}><Trash2 className="size-4 text-destructive" /></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pageCount > 1 && (
              <Paginator page={page} pageCount={pageCount} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
            )}
          </>
        )}
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New purchase order</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Supplier</Label>
                <SearchableSelect
                  value={form.supplier_id}
                  onValueChange={(v) => setForm({ ...form, supplier_id: v })}
                  placeholder="Select supplier"
                  options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                />
              </div>
              <div><Label>Expected delivery</Label><Input type="date" value={form.expected_date} onChange={e => setForm({ ...form, expected_date: e.target.value })} /></div>
            </div>
            <div className="space-y-2">
              <Label>Line items</Label>
              <p className="text-xs text-muted-foreground -mt-1">
                Pick an item from Inventory or Raw materials to auto-fill its name and cost, or choose “Custom” to enter a one-off. Stock is updated when you mark the PO as received.
              </p>
              <div className="hidden sm:grid grid-cols-12 gap-2 px-1 pt-1 text-xs font-medium text-muted-foreground">
                <div className="col-span-4">Item (Inventory / Raw material)</div>
                <div className="col-span-3">Description</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-2">Unit cost</div>
                <div className="col-span-1 sr-only">Remove</div>
              </div>
              {lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <SearchableSelect
                    value={sourceValue(l)}
                    onValueChange={(v) => pickSource(idx, v)}
                    className="col-span-4"
                    placeholder="Choose item"
                    searchPlaceholder="Search inventory & materials…"
                    options={sourceOptions}
                  />
                  <Input className="col-span-3" placeholder="Description" value={l.description} onChange={e => updateLine(idx, { description: e.target.value })} />
                  <Input className="col-span-2" type="number" min={0} placeholder="Qty" value={l.quantity} onChange={e => updateLine(idx, { quantity: Number(e.target.value) })} />
                  <Input className="col-span-2" type="number" min={0} placeholder="Cost" value={l.unit_cost || ""} onChange={e => updateLine(idx, { unit_cost: Number(e.target.value) })} />
                  <Button variant="ghost" size="icon" className="col-span-1" onClick={() => removeLine(idx)} aria-label="Remove line"><Trash2 className="size-4" /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addLine}><Plus className="size-4 mr-1" /> Add line</Button>
            </div>
            <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
            <div className="text-right text-lg font-semibold">Total: {fmt(subtotal)}</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={busy}>{busy ? "Saving…" : "Create PO"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-xl">
          {viewing && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {viewing.po_number}
                  <Badge variant={statusColor(viewing.status) as any}>{viewing.status}</Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div><span className="text-muted-foreground">Supplier:</span> {suppliers.find(s => s.id === viewing.supplier_id)?.name || "—"}</div>
                <div><span className="text-muted-foreground">Expected:</span> {viewing.expected_date || "—"}</div>
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
                <div className="text-right font-semibold">Total: {fmt(viewing.total_amount)}</div>
                {viewing.notes && <div className="text-muted-foreground">{viewing.notes}</div>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
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

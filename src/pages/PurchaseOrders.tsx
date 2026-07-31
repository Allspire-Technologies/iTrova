import { useEffect, useRef, useState } from "react";
import Hint from "@/components/Hint";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DatePicker from "@/components/DatePicker";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import SearchableSelect from "@/components/SearchableSelect";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import ConfirmDialog from "@/components/ConfirmDialog";
import { LandedCostEditor, toLandedRows, fromLandedRows, defaultLandedRows, type LandedRow } from "@/components/LandedCostEditor";
import { landedTotal, landedUnitCostsForPo, type LandedCostLine } from "@/lib/landedCost";
import { Plus, Search, ClipboardList, Trash2, Download, Upload, Eye, ArrowUp, ArrowDown, ArrowUpDown, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { downloadPdf } from "@/lib/pdf";
import { toCsv, downloadCsv, parseCsv, readFileText } from "@/lib/csv";
import { buildPoImportPlan, PO_FIELDS, templateHeaders, templateValues } from "@/lib/csvImport";
import { ImportProgressDialog, ImportResultDialog, type FailedImportRow, type ImportOutcome, type ImportProgress } from "@/components/ImportDialogs";
import Paginator, { usePagination } from "@/components/Paginator";
import { TablePageSkeleton } from "@/components/Skeletons";
import { getLimit, isAtLimit, limitMessage } from "@/lib/planLimits";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";

type PO = {
  id: string; po_number: string; supplier_id: string | null; status: string;
  expected_date: string | null; total_amount: number; notes: string | null; created_at: string; tax_amount?: number;
  landed_costs?: LandedCostLine[];
};
type Supplier = { id: string; name: string; phone: string | null; email: string | null; address: string | null };
type RawMat = { id: string; name: string; unit: string; cost_per_unit: number; weight?: number | null };
type Product = { id: string; name: string; unit: string | null; cost_price: number; weight?: number | null };
type LineSource = "product" | "material" | "custom";
// A saved PO item row (read for the view dialog + PDF). The editable form line adds `source`.
type POItemRow = { id?: string; product_id: string | null; raw_material_id: string | null; description: string; quantity: number; unit_cost: number; line_total: number };
type Item = POItemRow & { source: LineSource };

const STATUSES = ["draft", "sent", "received", "cancelled"];
type SortCol = "po_number" | "created_at" | "supplier" | "expected_date" | "total_amount" | "status";

export default function PurchaseOrders() {
  const { business, hasModule, can } = useAuth();
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
  const [viewItems, setViewItems] = useState<POItemRow[]>([]);
  const [form, setForm] = useState({ supplier_id: "", expected_date: "", notes: "" });
  const [lines, setLines] = useState<Item[]>([{ product_id: null, raw_material_id: null, description: "", quantity: 0, unit_cost: 0, line_total: 0, source: "product" }]);
  const [poTax, setPoTax] = useState<number>(0); // input VAT on this order (from the supplier invoice)
  const [landedRows, setLandedRows] = useState<LandedRow[]>(defaultLandedRows()); // freight/duty/other
  const taxEnabled = !!business?.tax_enabled;
  // Receive flow: edit landed costs before the PO is received and stock is valued.
  const [receiving, setReceiving] = useState<PO | null>(null);
  const [receiveDate, setReceiveDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [receiveRows, setReceiveRows] = useState<LandedRow[]>([]);
  const [receiveItems, setReceiveItems] = useState<POItemRow[]>([]);
  const [receiveBusy, setReceiveBusy] = useState(false);
  const [pending, setPending] = useState<{ title: string; description: string; confirmLabel?: string; variant?: "destructive" | "default"; onConfirm: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<ImportOutcome | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  const load = async () => {
    const [{ data: pos }, { data: sup }, { data: mat }, { data: prod }] = await Promise.all([
      supabase.from("purchase_orders")
        .select("id,po_number,supplier_id,status,expected_date,total_amount,notes,created_at,tax_amount,landed_costs")
        .order("created_at", { ascending: false }),
      supabase.from("suppliers").select("id, name, phone, email, address"),
      supabase.from("raw_materials").select("id, name, unit, cost_per_unit, weight"),
      supabase.from("products").select("id, name, unit, cost_price, weight").is("archived_at", null).order("name"),
    ]);
    setItems((pos as unknown as PO[]) || []); // tax_amount/landed_costs postdate the generated types
    setSuppliers((sup as Supplier[]) || []);
    setMaterials((mat as unknown as RawMat[]) || []); // weight postdates generated types
    setProducts((prod as unknown as Product[]) || []);
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
  // Per-line source filter drives which catalogue the item dropdown shows.
  const productOptions = products.map(p => ({ value: p.id, label: p.name }));
  const materialOptions = materials.map(m => ({ value: m.id, label: m.name }));
  const currentItemValue = (l: Item) => l.product_id ?? l.raw_material_id ?? "";
  // Switching source clears the picked item + its auto-filled description/cost.
  const setLineSource = (idx: number, source: LineSource) =>
    updateLine(idx, { source, product_id: null, raw_material_id: null, description: "", unit_cost: 0 });
  const pickItem = (idx: number, source: LineSource, id: string) => {
    if (source === "product") {
      const p = products.find(x => x.id === id);
      if (!p) return;
      updateLine(idx, { product_id: id, raw_material_id: null, description: p.unit ? `${p.name} (${p.unit})` : p.name, unit_cost: Number(p.cost_price) });
    } else {
      const m = materials.find(x => x.id === id);
      if (!m) return;
      updateLine(idx, { raw_material_id: id, product_id: null, description: `${m.name} (${m.unit})`, unit_cost: Number(m.cost_per_unit) });
    }
  };
  const addLine = () => setLines(prev => [...prev, { product_id: null, raw_material_id: null, description: "", quantity: 0, unit_cost: 0, line_total: 0, source: "product" }]);
  const removeLine = (idx: number) => setLines(prev => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx));

  const subtotal = lines.reduce((s, l) => s + (l.line_total || 0), 0);
  // Per-unit weight of a line's item (for weight-basis landed allocation).
  const unitWeightOf = (it: { product_id: string | null; raw_material_id: string | null }) =>
    it.product_id ? Number(products.find(p => p.id === it.product_id)?.weight) || 0
    : it.raw_material_id ? Number(materials.find(m => m.id === it.raw_material_id)?.weight) || 0
    : 0;
  // Live landed-cost allocation for the create dialog preview (mirrors the receive-trigger math).
  const landedClean = fromLandedRows(landedRows);
  const landedSum = landedTotal(landedClean);
  const landedPreview = landedUnitCostsForPo(lines.map(l => ({ unitCost: Number(l.unit_cost), qty: Number(l.quantity), weight: unitWeightOf(l) })), landedClean);
  // View dialog landed-cost breakdown (from the saved PO + its items).
  const viewLanded = (viewing?.landed_costs as LandedCostLine[] | undefined) || [];
  const viewLandedSum = landedTotal(viewLanded);
  const viewLandedPreview = landedUnitCostsForPo(viewItems.map(x => ({ unitCost: Number(x.unit_cost), qty: Number(x.quantity), weight: unitWeightOf(x) })), viewLanded);
  // Receive dialog preview.
  const receiveLandedSum = landedTotal(fromLandedRows(receiveRows));
  const receivePreview = landedUnitCostsForPo(receiveItems.map(x => ({ unitCost: Number(x.unit_cost), qty: Number(x.quantity), weight: unitWeightOf(x) })), fromLandedRows(receiveRows));

  const create = async () => {
    if (!business) return;
    if (isAtLimit(items.length, business.subscription_tier, "purchaseOrders")) {
      toast.error(limitMessage("purchaseOrders"));
      return;
    }
    if (lines.some(l => !l.description.trim())) return toast.error("Every line needs a description");
    if (lines.some(l => Number(l.quantity) <= 0)) return toast.error("Every line needs a quantity");
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
      tax_amount: taxEnabled ? (poTax || 0) : 0,
      landed_costs: fromLandedRows(landedRows),
    }).select().single(); // tax_amount/landed_costs postdate the generated types
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
    setLines([{ product_id: null, raw_material_id: null, description: "", quantity: 0, unit_cost: 0, line_total: 0, source: "product" }]);
    setPoTax(0);
    setLandedRows(defaultLandedRows());
    load();
  };

  const changeStatus = async (i: PO, status: string) => {
    const { error } = await supabase.from("purchase_orders").update({ status }).eq("id", i.id);
    if (error) return toast.error(error.message);
    if (status === "received") toast.success("PO received — stock updated");
    load();
  };

  // Receiving adds stock and values it (landed cost), and is final — open the receive dialog so the
  // user can drop in the actual freight/duty/clearing bill before stock is costed.
  const requestStatusChange = async (i: PO, status: string) => {
    if (status === i.status) return;
    if (status === "received") {
      setReceiving(i);
      setReceiveDate(new Date().toISOString().slice(0, 10));
      setReceiveRows(toLandedRows(i.landed_costs));
      const { data } = await supabase.from("purchase_order_items").select("*").eq("purchase_order_id", i.id);
      setReceiveItems((data as POItemRow[]) || []);
      return;
    }
    changeStatus(i, status);
  };

  const confirmReceive = async () => {
    if (!receiving) return;
    setReceiveBusy(true);
    // One update: persist the final landed costs AND flip to received, so the trigger costs stock
    // using the amounts just entered.
    const { error } = await supabase.from("purchase_orders")
      // received_at (settable receive date) is kept by the trigger's coalesce; stocked_date on the
      // rows it creates derives from it. Cast — received_at is set here for the first time via the app.
      .update({ landed_costs: fromLandedRows(receiveRows), status: "received", received_at: receiveDate } as never)
      .eq("id", receiving.id);
    setReceiveBusy(false);
    if (error) return toast.error(error.message);
    toast.success("PO received — stock added and valued at landed cost");
    setReceiving(null);
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
    setViewItems((data as POItemRow[]) || []);
  };

  const exportPdf = async (i: PO) => {
    const { data } = await supabase.from("purchase_order_items").select("*").eq("purchase_order_id", i.id);
    const sup = suppliers.find(s => s.id === i.supplier_id);
    downloadPdf({
      docType: "PURCHASE ORDER", docNumber: i.po_number, date: i.created_at.slice(0, 10),
      dueDate: i.expected_date, status: i.status,
      business: { name: business?.name || "", currency: business?.currency },
      partyLabel: "Supplier",
      party: { name: sup?.name || "—", phone: sup?.phone, email: sup?.email, address: sup?.address },
      items: ((data as POItemRow[]) || []).map(d => ({
        description: d.description, quantity: Number(d.quantity), unit_price: Number(d.unit_cost), line_total: Number(d.line_total),
      })),
      subtotal: Number(i.total_amount), tax: Number(i.tax_amount) || 0, total: Number(i.total_amount),
      landedCosts: (i.landed_costs || []).map(l => ({ label: l.label, amount: Number(l.amount) })),
      notes: i.notes,
    }, `${i.po_number}.pdf`);
  };

  // Rows sharing an Order Ref import as one multi-line PO; rows without one become single-line POs.
  const CSV_HEADERS = templateHeaders(PO_FIELDS);

  const downloadTemplate = () => {
    const examples = [
      ["PO-A", "Olu Farms Ltd", "2026-07-15", "Wheat Flour (50kg bag)", "10", "8500", "First batch order"],
      ["PO-A", "Olu Farms Ltd", "2026-07-15", "Brown Sugar (25kg bag)", "4", "12000", ""],
    ];
    downloadCsv("purchase-orders-template.csv", [CSV_HEADERS.join(","), ...examples.map(e => e.join(","))].join("\n"));
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
    try {
      const text = await readFileText(file);
      const rows = parseCsv(text);
      const plan = buildPoImportPlan(rows, suppliers, items.length, getLimit(business.subscription_tier, "purchaseOrders"));
      if (plan.pos.length === 0 && plan.rejected.length === 0) {
        return toast.error("No rows found in the file.");
      }

      const failed: FailedImportRow[] = plan.rejected.map(r => ({ values: templateValues(r.row, PO_FIELDS), reason: r.reason }));

      // One step per PO (each is a numbered document + its lines); a failed PO sinks its own rows only.
      const totalSteps = plan.pos.length;
      let done = 0;
      const tick = () => setImportProgress({ done: ++done, total: totalSteps });
      if (totalSteps > 0) setImportProgress({ done: 0, total: totalSteps });

      let created = 0, lineCount = 0;
      for (const po of plan.pos) {
        const failPo = (reason: string) => po.raws.forEach(raw => failed.push({ values: templateValues(raw, PO_FIELDS), reason }));
        const { data: numData } = await supabase.rpc("next_doc_number" as any, {
          _business_id: business.id, _prefix: "PO", _table: "purchase_orders", _col: "po_number",
        });
        const po_number: string = (numData as string) || `PO-${Date.now().toString().slice(-6)}`;
        const { data: created_po, error } = await supabase.from("purchase_orders").insert({
          business_id: business.id, po_number,
          supplier_id: po.supplier_id,
          expected_date: po.expected_date,
          notes: po.notes,
          total_amount: po.total_amount, status: "draft",
        }).select().single();
        if (error || !created_po) { failPo(`Upload failed: ${error?.message ?? "couldn't create the order"}`); tick(); continue; }
        const { error: itemsError } = await supabase.from("purchase_order_items").insert(
          po.items.map(i => ({ purchase_order_id: created_po.id, raw_material_id: null, ...i })),
        );
        if (itemsError) failPo(`Upload failed: ${itemsError.message}`);
        else { created++; lineCount += po.items.length; }
        tick();
      }

      setImportProgress(null);
      setImportResult({
        imported: lineCount,
        detail: created ? `${created} purchase order${created === 1 ? "" : "s"} created` : undefined,
        failed,
      });
      load();
    } catch (e: any) {
      setImportProgress(null);
      toast.error(e.message || "Import failed");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const downloadFailedRows = () => {
    if (!importResult?.failed.length) return;
    const cols = [...CSV_HEADERS, "Reason"];
    const rows = importResult.failed.map(f => ({ ...f.values, "Reason": f.reason }));
    downloadCsv(`purchase-orders-not-imported-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, cols));
  };

  const statusColor = (s: string) =>
    s === "received" ? "default" : s === "sent" ? "secondary" : s === "cancelled" ? "destructive" : "outline";

  // Shared between the desktop table rows and the mobile cards so both stay in sync.
  const StatusControl = ({ i }: { i: PO }) => (
    <SearchableSelect
      value={i.status}
      onValueChange={(v) => requestStatusChange(i, v)}
      disabled={i.status === "received"}
      className="w-28 h-8"
      options={STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
    />
  );
  const RowActions = ({ i }: { i: PO }) => (
    <div className="flex gap-1 justify-end">
      <Button variant="ghost" size="sm" onClick={() => openView(i)}><Eye className="size-4" /> View</Button>
      {can("purchase_orders", "download") && <Button variant="ghost" size="sm" onClick={() => exportPdf(i)}><Download className="size-4" /> PDF</Button>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`More actions for ${i.po_number}`}><MoreHorizontal className="size-4" /> More</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => remove(i)}><Trash2 className="size-4 mr-2" /> Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Purchase Orders</h1>
          <p className="text-muted-foreground mt-1">Orders to suppliers — mark as received to add stock</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Button variant="outline" onClick={downloadTemplate}><Download className="size-4" /> CSV Template</Button>
          {hasModule("csv_import") && can("purchase_orders", "csv_import") && <Hint label={atPoLimit ? limitMessage("purchaseOrders") : undefined} wrap><Button variant="outline" onClick={() => fileRef.current?.click()} disabled={atPoLimit}><Upload className="size-4" /> Import CSV</Button></Hint>}
          {hasModule("csv_export") && <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0}><Download className="size-4" /> Export CSV</Button>}
          {poLimit !== null && items.length >= Math.floor(poLimit * 0.8) && (
            <span className={`self-center text-xs font-medium ${atPoLimit ? "text-destructive" : "text-amber-600 dark:text-amber-400"}`}>
              {items.length} / {poLimit}
            </span>
          )}
          <Hint label={atPoLimit ? limitMessage("purchaseOrders") : undefined} wrap><Button onClick={() => { if (atPoLimit) { toast.error(limitMessage("purchaseOrders")); return; } setOpen(true); }} disabled={atPoLimit}><Plus className="size-4 mr-1" /> New PO</Button></Hint>
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
          className="w-full sm:w-40"
          options={[
            { value: "all", label: "All statuses" },
            ...STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
          ]}
        />
        <DatePicker value={dateFrom} onChange={v => { setDateFrom(v); setPage(1); }} className="w-full sm:w-36" clearable placeholder="Created from" aria-label="Created from" />
        <DatePicker value={dateTo} onChange={v => { setDateTo(v); setPage(1); }} className="w-full sm:w-36" clearable placeholder="Created to" aria-label="Created to" />
      </Card>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="size-14 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto mb-4"><ClipboardList className="size-6" /></div>
            <h3 className="font-display text-lg font-semibold text-brand-dark">No purchase orders yet</h3>
            <p className="text-muted-foreground text-sm mt-1 mb-4">Raise an order to a supplier — receiving it books the stock (and landed costs) automatically.</p>
            {can("purchase_orders", "create") && (
              <Button variant="brand" onClick={() => { if (atPoLimit) { toast.error(limitMessage("purchaseOrders")); return; } setOpen(true); }} disabled={atPoLimit}><Plus className="size-4" /> New PO</Button>
            )}
          </div>
        ) : (
          <>
            {/* Mobile: card list (the desktop table is too wide for phones) */}
            <div className="sm:hidden divide-y">
              {paged.map(i => (
                <div key={i.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold text-brand-dark">{i.po_number}</div>
                      <div className="text-sm text-muted-foreground truncate">{suppliers.find(s => s.id === i.supplier_id)?.name || "No supplier"}</div>
                    </div>
                    <div className="font-display font-bold text-brand-dark shrink-0">{fmt(i.total_amount)}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {fmtDate(i.created_at)}{i.expected_date ? ` · expected ${fmtDate(i.expected_date)}` : ""}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-border/50 pt-2">
                    <StatusControl i={i} />
                    <div className="ml-auto"><RowActions i={i} /></div>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop: full table */}
            <div className="hidden sm:block overflow-x-auto">
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
                      <td className="px-4 py-3">{i.expected_date ? fmtDate(i.expected_date) : "—"}</td>
                      <td className="px-4 py-3 text-right font-medium">{fmt(i.total_amount)}</td>
                      <td className="px-4 py-3">
                        <StatusControl i={i} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowActions i={i} />
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
        <DialogContent variant="wide" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New purchase order</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Supplier</Label>
                <SearchableSelect
                  value={form.supplier_id}
                  onValueChange={(v) => setForm({ ...form, supplier_id: v })}
                  placeholder="Select supplier"
                  options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                />
              </div>
              <div><Label>Expected delivery</Label><DatePicker value={form.expected_date} onChange={v => setForm({ ...form, expected_date: v })} clearable placeholder="Select date" /></div>
            </div>
            <div className="space-y-2">
              <Label>Line items</Label>
              <p className="text-xs text-muted-foreground -mt-1">
                Pick a source per line — <span className="font-medium">Inventory</span>, <span className="font-medium">Raw material</span>, or <span className="font-medium">Custom</span> — then choose the item (or type a one-off). Stock is updated when you mark the PO as received.
              </p>
              {lines.map((l, idx) => (
                <div key={idx} className="rounded-lg border border-border/60 p-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <ToggleGroup
                      type="single"
                      value={l.source}
                      onValueChange={(v) => v && setLineSource(idx, v as LineSource)}
                      size="sm"
                      variant="outline"
                      className="justify-start flex-wrap"
                    >
                      <ToggleGroupItem value="product" className="text-xs px-2.5" aria-label="Inventory">Inventory</ToggleGroupItem>
                      <ToggleGroupItem value="material" className="text-xs px-2.5" aria-label="Raw material">Raw material</ToggleGroupItem>
                      <ToggleGroupItem value="custom" className="text-xs px-2.5" aria-label="Custom">Custom</ToggleGroupItem>
                    </ToggleGroup>
                    <Button variant="ghost" size="icon" className="shrink-0" onClick={() => removeLine(idx)} aria-label="Remove line"><Trash2 className="size-4" /></Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-12 sm:items-center">
                    {l.source === "custom" ? (
                      <Input className="sm:col-span-8" placeholder="Item description" value={l.description} onChange={e => updateLine(idx, { description: e.target.value })} />
                    ) : (
                      <>
                        <SearchableSelect
                          value={currentItemValue(l)}
                          onValueChange={(v) => pickItem(idx, l.source, v)}
                          className="sm:col-span-5"
                          placeholder={l.source === "product" ? "Choose product" : "Choose material"}
                          searchPlaceholder={l.source === "product" ? "Search inventory…" : "Search materials…"}
                          options={l.source === "product" ? productOptions : materialOptions}
                        />
                        <Input className="sm:col-span-3" placeholder="Description" value={l.description} onChange={e => updateLine(idx, { description: e.target.value })} />
                      </>
                    )}
                    <div className="grid grid-cols-2 gap-2 sm:contents">
                      <Input className="sm:col-span-2" type="number" min={0} placeholder="Qty" value={l.quantity || ""} onChange={e => updateLine(idx, { quantity: Number(e.target.value) })} />
                      <Input className="sm:col-span-2" type="number" min={0} placeholder="Cost" value={l.unit_cost || ""} onChange={e => updateLine(idx, { unit_cost: Number(e.target.value) })} />
                    </div>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addLine}><Plus className="size-4 mr-1" /> Add line</Button>
            </div>
            <div><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>

            <div className="space-y-2 rounded-lg border border-border/60 p-3">
              <Label>Landed costs <span className="font-normal text-muted-foreground">(freight, duty, clearing… added to item cost, allocated across lines by value)</span></Label>
              <LandedCostEditor value={landedRows} onChange={setLandedRows} fmt={fmt} showBasis />
              {landedSum > 0 && lines.some(l => Number(l.quantity) > 0 && Number(l.unit_cost) > 0) && (
                <div className="space-y-1 pt-2 border-t border-border/40 text-xs">
                  <div className="font-medium text-muted-foreground">Effective cost per unit</div>
                  {lines.map((l, idx) => (Number(l.quantity) > 0 && Number(l.unit_cost) > 0) ? (
                    <div key={idx} className="flex justify-between gap-2">
                      <span className="truncate">{l.description || `Line ${idx + 1}`}</span>
                      <span className="shrink-0">{fmt(Number(l.unit_cost))} → <span className="font-medium text-brand-dark">{fmt(landedPreview[idx].landedUnit)}</span></span>
                    </div>
                  ) : null)}
                </div>
              )}
            </div>

            {taxEnabled && (
              <div className="flex items-center justify-end gap-2">
                <Label className="font-normal text-muted-foreground">of which VAT (input):</Label>
                <Input type="number" min="0" step="0.01" placeholder="0" className="w-32" value={poTax || ""} onChange={e => setPoTax(Number(e.target.value))} />
              </div>
            )}
            <div className="text-right">
              <div className="text-lg font-semibold">Total: {fmt(subtotal)}</div>
              {landedSum > 0 && <div className="text-sm text-muted-foreground">+ landed {fmt(landedSum)} = <span className="font-semibold text-brand-dark">{fmt(subtotal + landedSum)}</span> landed cost</div>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={busy}>{busy ? "Saving…" : "Create PO"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent variant="wide">
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
                {/* With input VAT, show the NET subtotal (total − VAT) so subtotal + VAT = total. */}
                {Number(viewing.tax_amount) > 0 ? (
                  <div className="space-y-1 text-right">
                    <div className="text-sm text-muted-foreground">Subtotal: {fmt(Number(viewing.total_amount) - Number(viewing.tax_amount))}</div>
                    <div className="text-sm text-muted-foreground">VAT: {fmt(Number(viewing.tax_amount))}</div>
                    <div className="font-semibold">Total: {fmt(viewing.total_amount)}</div>
                  </div>
                ) : (
                  <div className="text-right font-semibold">Total: {fmt(viewing.total_amount)}</div>
                )}
                {viewLandedSum > 0 && (
                  <div className="space-y-1 rounded-lg border border-border/60 p-3 text-sm">
                    <div className="font-medium text-brand-dark">Landed costs</div>
                    {viewLanded.map((l, i) => (
                      <div key={i} className="flex justify-between text-muted-foreground"><span>{l.label}</span><span>{fmt(Number(l.amount))}</span></div>
                    ))}
                    <div className="flex justify-between border-t border-border/40 pt-1 font-medium">
                      <span>Landed cost total</span><span>{fmt(Number(viewing.total_amount) + viewLandedSum)}</span>
                    </div>
                    <div className="pt-1 text-xs">
                      <div className="font-medium text-muted-foreground">Effective cost per unit</div>
                      {viewItems.map((it, idx) => (Number(it.quantity) > 0 && Number(it.unit_cost) > 0) ? (
                        <div key={idx} className="flex justify-between gap-2">
                          <span className="truncate">{it.description}</span>
                          <span className="shrink-0">{fmt(Number(it.unit_cost))} → <span className="font-medium text-brand-dark">{fmt(viewLandedPreview[idx].landedUnit)}</span></span>
                        </div>
                      ) : null)}
                    </div>
                  </div>
                )}
                {viewing.notes && <div className="text-muted-foreground">{viewing.notes}</div>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setViewing(null)}>Close</Button>
                {can("purchase_orders", "download") && <Button onClick={() => exportPdf(viewing)}><Download className="size-4 mr-1" /> Download PDF</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Receive dialog — add the real landed costs before stock is added & valued */}
      <Dialog open={!!receiving} onOpenChange={(o) => { if (!o && !receiveBusy) setReceiving(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="font-display">Receive {receiving?.po_number}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Add the actual freight, duty and clearing costs from the supplier/agent bills. Stock is added and
            <span className="font-medium text-foreground"> valued at cost including these</span> (allocated across items by value). This can{"'"}t be undone.
          </p>
          <div className="space-y-2">
            <Label>Received date</Label>
            <DatePicker value={receiveDate} onChange={setReceiveDate} max={new Date().toISOString().slice(0, 10)} placeholder="Received date" />
          </div>
          <div className="space-y-2">
            <Label>Landed costs</Label>
            <LandedCostEditor value={receiveRows} onChange={setReceiveRows} fmt={fmt} showBasis />
          </div>
          {receiveLandedSum > 0 && receiveItems.length > 0 && (
            <div className="space-y-1 border-t border-border/40 pt-2 text-xs">
              <div className="font-medium text-muted-foreground">Effective cost per unit</div>
              {receiveItems.map((it, idx) => (Number(it.quantity) > 0 && Number(it.unit_cost) > 0) ? (
                <div key={idx} className="flex justify-between gap-2">
                  <span className="truncate">{it.description}</span>
                  <span className="shrink-0">{fmt(Number(it.unit_cost))} → <span className="font-medium text-brand-dark">{fmt(receivePreview[idx].landedUnit)}</span></span>
                </div>
              ) : null)}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiving(null)} disabled={receiveBusy}>Cancel</Button>
            <Button onClick={confirmReceive} disabled={receiveBusy}>{receiveBusy ? "Receiving…" : "Receive & value stock"}</Button>
          </DialogFooter>
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
      <ImportProgressDialog progress={importProgress} noun="purchase orders" />
      <ImportResultDialog result={importResult} onClose={() => setImportResult(null)} onDownloadFailed={downloadFailedRows} />
    </div>
  );
}

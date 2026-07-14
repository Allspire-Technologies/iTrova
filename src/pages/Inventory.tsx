import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DatePicker from "@/components/DatePicker";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ImportProgressDialog, ImportResultDialog, type FailedImportRow, type ImportOutcome, type ImportProgress } from "@/components/ImportDialogs";
import { Plus, Search, Package, Pencil, Upload, Download, SlidersHorizontal, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import SearchableSelect from "@/components/SearchableSelect";
import { toast } from "sonner";
import { toCsv, downloadCsv, parseCsv, readFileText } from "@/lib/csv";
import StockAdjustDialog from "@/components/StockAdjustDialog";
import Paginator, { usePagination } from "@/components/Paginator";
import { TablePageSkeleton } from "@/components/Skeletons";
import { getLimit, isAtLimit, limitMessage } from "@/lib/planLimits";
import { findSkuConflict, buildImportPlan, expiryAlert, canonicalizeRow, productProfitStats, type ProductFields } from "@/lib/inventoryRules";
import { listTaxes, formatRate, type Tax } from "@/lib/tax";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { useOnline } from "@/contexts/OnlineContext";
import { ReadOnlyOfflineNotice } from "@/components/OfflineBanner";
import { cacheProducts, readCachedProducts } from "@/lib/offlineStore";

type Product = {
  id: string;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string | null;
  selling_price: number;
  cost_price: number;
  stock_quantity: number;
  reorder_level: number;
  expiry_date?: string | null;
  tax_id?: string | null;
  weight?: number | null;
};

const empty = { name: "", category: "", sku: "", unit: "pcs", selling_price: "", cost_price: "", stock_quantity: "", reorder_level: 5, expiry_date: "", tax_id: "", weight: "" };

// Markup on cost, one decimal place — e.g. 23.3% or -10.0% for a loss.
const formatMarkup = (pct: number) => `${pct.toFixed(1)}%`;

// Click-to-open explainer for the Profit column (how the totals and markup % are worked out).
function ProfitInfo() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="How profit is calculated" className="text-muted-foreground hover:text-brand transition-colors">
          <Info className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 text-left normal-case tracking-normal">
        <p className="text-sm font-medium text-brand-dark">How profit is calculated</p>
        <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
          <li><span className="font-medium text-brand-dark">Cost total</span> = cost price × stock on hand.</li>
          <li><span className="font-medium text-brand-dark">Profit</span> = (sale price − cost price) × stock on hand.</li>
          <li>The percentage is <span className="font-medium text-brand-dark">markup on cost</span> — (sale price − cost price) ÷ cost price.</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">Shown as “—” when a product has no cost price yet.</p>
      </PopoverContent>
    </Popover>
  );
}

export default function Inventory() {
  const { business, hasModule } = useAuth();
  const { online } = useOnline();
  const { fmt, symbol } = useCurrency();
  const { fmtDate, timezone } = useDateFormat();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(() => searchParams.get("q") || "");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get("status") || "all");
  const [expiryFilter, setExpiryFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<any>(empty);
  const [busy, setBusy] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<Product | null>(null);
  const [importResult, setImportResult] = useState<ImportOutcome | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const taxEnabled = !!business?.tax_enabled;
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const defaultTaxId = taxes.find(t => t.is_default && t.active)?.id ?? "";

  const load = async () => {
    if (!business) return;
    if (!online) {
      // Offline: read-only list from the last-synced cache.
      const cached = await readCachedProducts(business.id);
      setItems(cached.map((c) => ({ ...c, unit: null, cost_price: 0 })) as Product[]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase.from("products")
      .select("id,name,category,sku,unit,selling_price,cost_price,stock_quantity,reorder_level,expiry_date,tax_id,weight")
      .order("created_at", { ascending: false });
    if (error) return toast.error(error.message);
    const rows = (data as unknown as Product[]) || []; // tax_id/weight postdate generated types
    setItems(rows);
    if (taxEnabled) listTaxes().then(setTaxes).catch(() => {});
    setLoading(false);
    void cacheProducts(
      business.id,
      rows.map((r) => ({ id: r.id, business_id: business.id, name: r.name, sku: r.sku, selling_price: r.selling_price, stock_quantity: r.stock_quantity, reorder_level: r.reorder_level, category: r.category })),
    );
  };

  useEffect(() => { if (business) load(); }, [business, online]);

  const openAdd = () => { setEditing(null); setForm({ ...empty, tax_id: taxEnabled ? defaultTaxId : "" }); setOpen(true); };
  const openEdit = (p: Product) => { setEditing(p); setForm(p); setOpen(true); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business) return;
    if (!editing && isAtLimit(items.length, business.subscription_tier, "products")) {
      toast.error(limitMessage("products"));
      return;
    }
    const sku = (form.sku || "").trim();
    if (!sku) { toast.error("SKU is required"); return; }
    const dup = findSkuConflict(sku, items, editing?.id);
    if (dup) { toast.error(`SKU "${sku}" is already used by ${dup.name}`); return; }
    setBusy(true);
    const payload = {
      name: form.name,
      category: form.category || null,
      sku,
      unit: form.unit || "pcs",
      selling_price: Number(form.selling_price) || 0,
      cost_price: Number(form.cost_price) || 0,
      reorder_level: Number(form.reorder_level) || 0,
      expiry_date: form.expiry_date || null,
      // Empty string (Exempt, or tax disabled) must become NULL — "" is not a valid uuid.
      tax_id: form.tax_id || null,
      weight: Number(form.weight) || null, // per-unit weight for landed-cost (freight) allocation
    };
    // tax_id postdates the generated Supabase types — cast until types are regenerated.
    const { error } = editing
      ? await supabase.from("products").update(payload as never).eq("id", editing.id)
      : await supabase.from("products").insert({ ...payload, stock_quantity: Number(form.stock_quantity) || 0, business_id: business.id } as never);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Product updated" : "Product added");
    setOpen(false);
    load();
  };

  // Human-readable headers for the template/export. Import is case/spacing-insensitive and accepts
  // these plus common aliases (see inventoryRules canonicalizeRow), so re-importing either an old
  // snake_case export or this friendlier one both work.
  // The Tax column (by tax name) only appears when tax is enabled — non-tax businesses keep the
  // original 9-column shape, and old exports still re-import fine (a missing Tax column = unchanged).
  const CSV_HEADERS = ["Name", "Category", "SKU", "Unit", "Selling Price", "Cost Price", "Stock Quantity", "Reorder Level", "Expiry Date", "Weight", ...(taxEnabled ? ["Tax"] : [])];
  const taxNameOf = (id: string | null | undefined) => (id ? taxes.find(t => t.id === id)?.name ?? "" : "");

  const downloadTemplate = () => {
    const example = ["Garri 50kg", "Foodstuff", "GAR-50", "bag", "8500", "6000", "20", "5", "2026-12-31", "50", ...(taxEnabled ? ["VAT"] : [])];
    const csv = [CSV_HEADERS.join(","), example.join(",")].join("\n");
    downloadCsv("products-template.csv", csv);
    toast.success("Template downloaded");
  };

  const exportCsv = () => {
    const rows = items.map(p => ({
      "Name": p.name, "Category": p.category || "", "SKU": p.sku || "", "Unit": p.unit || "pcs",
      "Selling Price": p.selling_price, "Cost Price": p.cost_price,
      "Stock Quantity": p.stock_quantity, "Reorder Level": p.reorder_level,
      "Expiry Date": p.expiry_date || "", "Weight": p.weight ?? "", "Tax": taxNameOf(p.tax_id),
    }));
    downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, CSV_HEADERS));
    toast.success(`Exported ${rows.length} product${rows.length === 1 ? "" : "s"}`);
  };

  // Present a failed row in the template's columns so the re-download is fixable & re-importable.
  const templateValuesFromRaw = (row: Record<string, string | undefined>): Record<string, string> => {
    const c = canonicalizeRow(row);
    return {
      "Name": c.name ?? "", "Category": c.category ?? "", "SKU": c.sku ?? "", "Unit": c.unit ?? "",
      "Selling Price": c.selling_price ?? "", "Cost Price": c.cost_price ?? "",
      "Stock Quantity": c.stock_quantity ?? "", "Reorder Level": c.reorder_level ?? "", "Expiry Date": c.expiry_date ?? "",
      "Weight": c.weight ?? "", "Tax": c.tax ?? "",
    };
  };
  const templateValuesFromFields = (f: ProductFields, stock: number): Record<string, string> => ({
    "Name": f.name, "Category": f.category ?? "", "SKU": f.sku, "Unit": f.unit,
    "Selling Price": String(f.selling_price), "Cost Price": String(f.cost_price),
    "Stock Quantity": String(stock), "Reorder Level": String(f.reorder_level), "Expiry Date": f.expiry_date ?? "",
    "Weight": f.weight != null ? String(f.weight) : "", "Tax": taxNameOf(f.tax_id),
  });

  const importCsv = async (file: File) => {
    if (!business) return;
    try {
      const text = await readFileText(file);
      const rows = parseCsv(text);
      const plan = buildImportPlan(rows, items, items.length, getLimit(business.subscription_tier, "products"), taxEnabled ? taxes.map(t => ({ id: t.id, name: t.name })) : undefined);
      if (plan.inserts.length === 0 && plan.updates.length === 0 && plan.rejected.length === 0) {
        return toast.error("No rows found in the file.");
      }

      // Start the misses with the rows that failed validation or the plan limit, then add any DB errors.
      const failed: FailedImportRow[] = plan.rejected.map(r => ({ values: templateValuesFromRaw(r.row), reason: r.reason }));

      // Inserts go up in batches (kinder to large files) so we can advance a real progress bar: one
      // step per restock plus one per insert batch. A failed batch only sinks its own rows.
      const INSERT_BATCH = 100;
      const insertBatches: (typeof plan.inserts)[] = [];
      for (let i = 0; i < plan.inserts.length; i += INSERT_BATCH) insertBatches.push(plan.inserts.slice(i, i + INSERT_BATCH));
      const totalSteps = plan.updates.length + insertBatches.length;
      let done = 0;
      const tick = () => setImportProgress({ done: ++done, total: totalSteps });
      if (totalSteps > 0) setImportProgress({ done: 0, total: totalSteps });

      let restocked = 0;
      for (const u of plan.updates) {
        const { error } = await supabase.from("products").update({ ...u.fields, stock_quantity: u.stock } as never).eq("id", u.id);
        if (error) failed.push({ values: templateValuesFromFields(u.fields, u.stock), reason: `Update failed: ${error.message}` });
        else restocked++;
        tick();
      }

      let added = 0;
      for (const batch of insertBatches) {
        const { error } = await supabase.from("products").insert(batch.map(i => ({ ...i, business_id: business.id })) as never);
        if (error) batch.forEach(i => failed.push({ values: templateValuesFromFields(i, i.stock_quantity), reason: `Upload failed: ${error.message}` }));
        else added += batch.length;
        tick();
      }

      setImportProgress(null);
      const detail = [added ? `${added} added` : "", restocked ? `${restocked} restocked` : ""].filter(Boolean).join(" · ");
      setImportResult({ imported: added + restocked, detail: detail || undefined, failed });
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
    downloadCsv(`products-not-imported-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, cols));
  };

  const categories = [...new Set(items.map(i => i.category).filter(Boolean) as string[])].sort();
  const todayInTz = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());

  const filtered = items.filter(i => {
    if (q && !i.name.toLowerCase().includes(q.toLowerCase()) && !i.sku?.toLowerCase().includes(q.toLowerCase())) return false;
    if (categoryFilter !== "all" && i.category !== categoryFilter) return false;
    if (statusFilter !== "all") {
      const stock = Number(i.stock_quantity);
      const reorder = Number(i.reorder_level);
      if (statusFilter === "in_stock" && !(stock > reorder)) return false;
      if (statusFilter === "low_stock" && !(stock > 0 && stock <= reorder)) return false;
      if (statusFilter === "out_of_stock" && stock > 0) return false;
    }
    if (expiryFilter !== "all") {
      const ex = expiryAlert(i.expiry_date, todayInTz);
      if (expiryFilter === "expiring" && !(ex && ex.band !== "expired")) return false; // within 90 days, not yet expired
      if (expiryFilter === "expired" && !(ex && ex.band === "expired")) return false;
      if (expiryFilter === "none" && i.expiry_date) return false;
    }
    return true;
  });
  const { paged, page, setPage, pageSize, setPageSize, pageCount, total } = usePagination(filtered, 20);

  // Sync filters from the URL on same-route navigation (deep-links while already mounted).
  useEffect(() => {
    const qp = searchParams.get("q");
    const sp = searchParams.get("status");
    if (qp !== null) setQ(qp);
    if (sp !== null) setStatusFilter(sp);
    if (qp !== null || sp !== null) setPage(1);
  }, [searchParams, setPage]);

  const statusOf = (p: Product) => {
    const stock = Number(p.stock_quantity);
    const reorder = Number(p.reorder_level);
    if (stock <= 0) return { label: "Out of stock", className: "bg-danger/10 text-danger border-danger/20" };
    if (stock <= reorder) return { label: "Low stock", className: "bg-warning/10 text-warning border-warning/20" };
    return { label: "In stock", className: "bg-brand-light text-brand-dark border-brand/20" };
  };

  const tier = business?.subscription_tier;
  const productLimit = getLimit(tier, "products");
  const atProductLimit = isAtLimit(items.length, tier, "products");

  if (loading) return <TablePageSkeleton />;

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">Inventory</h1>
          <p className="text-muted-foreground mt-1">Manage all your finished products and stock levels.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
          <Button variant="outline" onClick={downloadTemplate}><Download className="size-4" /> CSV Template</Button>
          {online && hasModule("csv_import") && <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={atProductLimit} title={atProductLimit ? limitMessage("products") : undefined}><Upload className="size-4" /> Import CSV</Button>}
          {hasModule("csv_export") && <Button variant="outline" onClick={exportCsv} disabled={items.length === 0}><Download className="size-4" /> Export</Button>}
          {productLimit !== null && items.length >= Math.floor(productLimit * 0.8) && (
            <span className={`self-center text-xs font-medium ${atProductLimit ? "text-destructive" : "text-amber-600"}`}>
              {items.length} / {productLimit}
            </span>
          )}
          {online && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="hero" onClick={openAdd} disabled={atProductLimit} title={atProductLimit ? limitMessage("products") : undefined}><Plus className="size-4" /> Add product</Button>
            </DialogTrigger>
            <DialogContent variant="wide">
              <DialogHeader>
                <DialogTitle className="font-display">{editing ? "Edit product" : "Add a new product"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={save} className="space-y-4">
                <div className="space-y-2">
                  <Label>Product name *</Label>
                  <Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Garri (50kg)" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Input value={form.category || ""} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="Foodstuff" />
                  </div>
                  <div className="space-y-2">
                    <Label>SKU / barcode *</Label>
                    <Input required value={form.sku || ""} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="GAR-50" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Selling price ({symbol}) *</Label>
                    <Input type="number" required min="0" step="0.01" placeholder="0" value={form.selling_price} onChange={e => setForm({ ...form, selling_price: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Cost price ({symbol}) *</Label>
                    <Input type="number" required min="0" step="0.01" placeholder="0" value={form.cost_price} onChange={e => setForm({ ...form, cost_price: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Stock quantity *</Label>
                    <Input type="number" required min="0" step="1" placeholder="0" value={form.stock_quantity} disabled={!!editing} onChange={e => setForm({ ...form, stock_quantity: e.target.value })} />
                    {editing && <p className="text-xs text-muted-foreground">Use “Adjust stock” to change quantity.</p>}
                  </div>
                  <div className="space-y-2">
                    <Label>Reorder level *</Label>
                    <Input type="number" required min="0" step="1" value={form.reorder_level} onChange={e => setForm({ ...form, reorder_level: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Expiry date <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <DatePicker value={form.expiry_date || ""} onChange={v => setForm({ ...form, expiry_date: v })} clearable placeholder="Select date" />
                  </div>
                  <div className="space-y-2">
                    <Label>Weight per unit <span className="font-normal text-muted-foreground">(optional)</span></Label>
                    <Input type="number" min="0" step="any" placeholder="e.g. 25" value={form.weight ?? ""} onChange={e => setForm({ ...form, weight: e.target.value })} />
                    <p className="text-xs text-muted-foreground">Used to split freight across a purchase order by weight.</p>
                  </div>
                </div>
                {taxEnabled && (
                  <div className="space-y-2">
                    <Label>Tax</Label>
                    <SearchableSelect
                      value={form.tax_id || "exempt"}
                      onValueChange={v => setForm({ ...form, tax_id: v === "exempt" ? "" : v })}
                      options={[{ value: "exempt", label: "Exempt (no tax)" }, ...taxes.filter(t => t.active).map(t => ({ value: t.id, label: `${t.name} (${formatRate(t.rate)})` }))]}
                    />
                    <p className="text-xs text-muted-foreground">Staple foods are usually VAT-exempt; most other goods carry VAT.</p>
                  </div>
                )}
                <DialogFooter>
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" variant="brand" disabled={busy}>{busy ? "Saving..." : editing ? "Save changes" : "Add product"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          )}
        </div>
      </div>

      <Card className="shadow-card border-border/60">
        <div className="p-4 border-b border-border flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px] max-w-sm">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name or SKU" className="pl-9" />
          </div>
          <SearchableSelect
            value={categoryFilter}
            onValueChange={setCategoryFilter}
            className="w-40"
            placeholder="Category"
            options={[
              { value: "all", label: "All categories" },
              ...categories.map(c => ({ value: c, label: c })),
            ]}
          />
          <SearchableSelect
            value={statusFilter}
            onValueChange={setStatusFilter}
            className="w-36"
            placeholder="Status"
            options={[
              { value: "all", label: "All statuses" },
              { value: "in_stock", label: "In stock" },
              { value: "low_stock", label: "Low stock" },
              { value: "out_of_stock", label: "Out of stock" },
            ]}
          />
          <SearchableSelect
            value={expiryFilter}
            onValueChange={setExpiryFilter}
            className="w-40"
            placeholder="Expiry"
            options={[
              { value: "all", label: "All expiry" },
              { value: "expiring", label: "Expiring (≤90d)" },
              { value: "expired", label: "Expired" },
              { value: "none", label: "No expiry date" },
            ]}
          />
          <div className="text-sm text-muted-foreground ml-auto">{filtered.length} of {items.length}</div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="size-14 rounded-2xl bg-brand-light text-brand grid place-items-center mx-auto mb-4">
              <Package className="size-6" />
            </div>
            <h3 className="font-display text-lg font-semibold text-brand-dark">No products yet</h3>
            <p className="text-muted-foreground text-sm mt-1 mb-4">{online ? "Add your first product or import a CSV." : "No cached products to show offline."}</p>
            {online && <Button variant="brand" onClick={openAdd} disabled={atProductLimit}><Plus className="size-4" /> Add product</Button>}
          </div>
        ) : (
          <>
          {/* Mobile: card list (the desktop table's 7 columns don't fit a phone) */}
          <div className="sm:hidden divide-y">
            {paged.map(p => {
              const s = statusOf(p);
              const ex = expiryAlert(p.expiry_date, todayInTz);
              const pp = productProfitStats(p);
              return (
                <div key={p.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-brand-dark truncate">{p.name}</div>
                      {p.sku && <div className="text-xs text-muted-foreground">{p.sku}</div>}
                      <div className="text-xs text-muted-foreground mt-0.5">{p.category || "Uncategorized"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-display font-semibold text-brand-dark">{fmt(p.selling_price)}</div>
                      <div className="text-sm">{Number(p.stock_quantity)} <span className="text-xs text-muted-foreground">{p.unit}</span></div>
                    </div>
                  </div>
                  {pp.markupPct !== null && (
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">Cost total <span className="font-medium text-brand-dark">{fmt(pp.costTotal)}</span></span>
                      <span className={`inline-flex items-center gap-1 ${pp.profitTotal < 0 ? "text-danger" : "text-brand-dark"}`}>Profit <span className="font-medium">{fmt(pp.profitTotal)}</span> <span className={`text-xs ${pp.profitTotal < 0 ? "text-danger/80" : "text-muted-foreground"}`}>{formatMarkup(pp.markupPct)}</span> <ProfitInfo /></span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <Badge variant="outline" className={s.className}>{s.label}</Badge>
                      {p.expiry_date && ex && <Badge variant="outline" className={ex.className}>{ex.label}</Badge>}
                      {p.expiry_date && <span className="text-xs text-muted-foreground">exp {fmtDate(p.expiry_date)}</span>}
                    </div>
                    {online && (
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => setAdjustTarget(p)}><SlidersHorizontal className="size-4" /> Adjust</Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(p)}><Pencil className="size-4" /> Edit</Button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Desktop: full table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="px-4 py-3">Product</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3 text-right">Sale price</th>
                  <th className="px-4 py-3 text-right">Cost total</th>
                  <th className="px-4 py-3 text-right">
                    <span className="inline-flex items-center justify-end gap-1">Profit <ProfitInfo /></span>
                  </th>
                  <th className="px-4 py-3">Expiry</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map(p => {
                  const s = statusOf(p);
                  const ex = expiryAlert(p.expiry_date, todayInTz);
                  const pp = productProfitStats(p);
                  return (
                    <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/40 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-brand-dark">{p.name}</div>
                        {p.sku && <div className="text-xs text-muted-foreground">{p.sku}</div>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{p.category || "Uncategorized"}</td>
                      <td className="px-4 py-3 text-right font-medium">{Number(p.stock_quantity)} <span className="text-xs text-muted-foreground">{p.unit}</span></td>
                      <td className="px-4 py-3 text-right font-display font-semibold text-brand-dark">{fmt(p.selling_price)}</td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                        {pp.markupPct === null ? <span className="text-muted-foreground">—</span> : fmt(pp.costTotal)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {pp.markupPct === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <div className={`tabular-nums ${pp.profitTotal < 0 ? "text-danger" : "text-brand-dark"}`}>
                            <div className="font-medium">{fmt(pp.profitTotal)}</div>
                            <div className={`text-xs ${pp.profitTotal < 0 ? "text-danger/80" : "text-muted-foreground"}`}>{formatMarkup(pp.markupPct)}</div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {p.expiry_date ? (
                          <div className="flex flex-col items-start gap-1">
                            <span className="text-muted-foreground">{fmtDate(p.expiry_date)}</span>
                            {ex && <Badge variant="outline" className={ex.className}>{ex.label}</Badge>}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3"><Badge variant="outline" className={s.className}>{s.label}</Badge></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {online ? (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => setAdjustTarget(p)}><SlidersHorizontal className="size-4" /> Adjust</Button>
                            <Button variant="ghost" size="sm" onClick={() => openEdit(p)}><Pencil className="size-4" /> Edit</Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Paginator page={page} pageCount={pageCount} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        )}
      </Card>

      <StockAdjustDialog
        open={!!adjustTarget}
        onOpenChange={(v) => !v && setAdjustTarget(null)}
        target={adjustTarget ? { kind: "product", id: adjustTarget.id, name: adjustTarget.name, unit: adjustTarget.unit, stock_quantity: Number(adjustTarget.stock_quantity) } : null}
        onSaved={load}
      />

      <ImportProgressDialog progress={importProgress} noun="products" />
      <ImportResultDialog result={importResult} onClose={() => setImportResult(null)} onDownloadFailed={downloadFailedRows} />
    </div>
  );
}

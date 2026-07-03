import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, FileDown, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  emptyItem,
  lineTotal,
  invoiceTotal,
  formatExportMoney,
  nextExportInvoiceNumber,
  saveExportInvoice,
  listExportInvoices,
  downloadExportInvoicePdf,
  type ExportInvoiceItem,
  type ExportInvoiceRecord,
  type ExportInvoiceDraft,
} from "@/lib/exportInvoice";

const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "GHS", "CAD", "ZAR", "KES"];

export default function ExportInvoice() {
  const { business, user, role } = useAuth();
  const isOwner = role === "owner";

  // Seller (from the exporter profile; owner-editable, read-only for managers).
  const [seller, setSeller] = useState({ name: "", address: "", email: "", phone: "" });
  // Buyer + meta.
  const [buyer, setBuyer] = useState({ name: "", address: "", country: "" });
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [items, setItems] = useState<ExportInvoiceItem[]>([emptyItem()]);
  const [notes, setNotes] = useState("");

  const [productNames, setProductNames] = useState<string[]>([]);
  const [history, setHistory] = useState<ExportInvoiceRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [numberLoading, setNumberLoading] = useState(true);

  // Prefill seller + defaults from the business.
  useEffect(() => {
    if (!business) return;
    setSeller({
      name: business.name || "",
      address: [business.export_address, business.city, business.state].filter(Boolean).join(", "),
      email: business.export_email || "",
      phone: business.export_phone || business.whatsapp_number || "",
    });
    setCountry(business.export_country || "");
    setCurrency(business.currency || "NGN");
  }, [business]);

  // Reserve the next number, load product names (for the description hints) and recent invoices.
  useEffect(() => {
    if (!business) return;
    nextExportInvoiceNumber(business.id)
      .then(setNumber)
      .catch((e) => toast.error(e?.message ?? "Couldn't reserve an invoice number"))
      .finally(() => setNumberLoading(false));
    supabase.from("products").select("name").order("name").then(({ data }) => {
      if (data) setProductNames((data as { name: string }[]).map((p) => p.name).filter(Boolean));
    });
    listExportInvoices().then(setHistory).catch(() => {});
  }, [business]);

  const total = useMemo(() => invoiceTotal(items), [items]);
  const money = (n: number) => formatExportMoney(n, currency);

  function patchItem(i: number, patch: Partial<ExportInvoiceItem>) {
    setItems((list) => list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  const addRow = () => setItems((l) => [...l, emptyItem()]);
  const removeRow = (i: number) => setItems((l) => (l.length === 1 ? l : l.filter((_, idx) => idx !== i)));

  function currentDraft(): ExportInvoiceDraft {
    return { invoice_number: number.trim(), invoice_date: date, country_of_origin: country.trim(), currency, seller, buyer, items, notes: notes.trim() };
  }

  async function saveAndDownload() {
    if (!business) return;
    if (!buyer.name.trim()) return toast.error("Enter the buyer's name");
    const usable = items.filter((it) => it.description.trim() && (Number(it.boxes) || 0) > 0);
    if (usable.length === 0) return toast.error("Add at least one line item with a description and boxes");
    if (!number.trim()) return toast.error("Invoice number is required");

    setBusy(true);
    try {
      const draft: ExportInvoiceDraft = { ...currentDraft(), items: usable };
      const saved = await saveExportInvoice(business.id, user?.id ?? null, draft);
      await downloadExportInvoicePdf(draft, `${draft.invoice_number.replace(/[^\w.-]+/g, "-")}.pdf`);
      setHistory((h) => [saved, ...h]);
      toast.success(`Export invoice ${saved.invoice_number} saved`);
      // Start a fresh one: keep seller/meta, clear buyer + items, reserve the next number.
      setBuyer({ name: "", address: "", country: "" });
      setItems([emptyItem()]);
      setNotes("");
      setNumberLoading(true);
      nextExportInvoiceNumber(business.id).then(setNumber).catch(() => {}).finally(() => setNumberLoading(false));
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Couldn't save the invoice");
    } finally {
      setBusy(false);
    }
  }

  const sellerField = (label: string, value: string, onChange: (v: string) => void, placeholder: string, multiline = false) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      {multiline ? (
        <textarea
          className="min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70"
          value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={!isOwner}
        />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={!isOwner} />
      )}
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <datalist id="export-product-names">
        {productNames.map((n) => <option key={n} value={n} />)}
      </datalist>

      <div>
        <h1 className="font-display text-2xl lg:text-3xl font-bold text-brand-dark">Export Invoice</h1>
        <p className="text-muted-foreground text-sm">Generate an international commercial invoice and download it as PDF.</p>
      </div>

      {/* Exporter (seller) */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-lg">Exporter (Seller)</CardTitle>
          <CardDescription>
            {isOwner ? "Prefilled from your Exporter Profile. Edit here for this invoice, or update the defaults in Settings." : "Managed by the business owner in Settings."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sellerField("Company name", seller.name, (v) => setSeller((s) => ({ ...s, name: v })), "Exporter company name")}
          {sellerField("Phone", seller.phone, (v) => setSeller((s) => ({ ...s, phone: v })), "Phone number")}
          {sellerField("Email", seller.email, (v) => setSeller((s) => ({ ...s, email: v })), "exports@example.com")}
          {sellerField("Address", seller.address, (v) => setSeller((s) => ({ ...s, address: v })), "Street, area, city, state", true)}
        </CardContent>
      </Card>

      {/* Invoice details + buyer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-3"><CardTitle className="font-display text-lg">Invoice details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Invoice number</Label>
              <Input value={numberLoading ? "" : number} onChange={(e) => setNumber(e.target.value)} placeholder={numberLoading ? "Reserving…" : "Invoice number"} aria-label="Invoice number" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Country of origin</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-3"><CardTitle className="font-display text-lg">Buyer (Importer)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label>Buyer name</Label>
              <Input value={buyer.name} onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))} placeholder="Importer company name" />
            </div>
            <div className="space-y-2">
              <Label>Buyer address</Label>
              <textarea className="min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={buyer.address} onChange={(e) => setBuyer((b) => ({ ...b, address: e.target.value }))} placeholder="Street, city, province, postal code" />
            </div>
            <div className="space-y-2">
              <Label>Buyer country</Label>
              <Input value={buyer.country} onChange={(e) => setBuyer((b) => ({ ...b, country: e.target.value }))} placeholder="Country" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Line items */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="font-display text-lg">Products</CardTitle>
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="size-4" /> Add row</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Column headers (desktop) */}
          <div className="hidden md:grid grid-cols-[1.6fr_0.8fr_0.9fr_0.6fr_0.9fr_0.9fr_auto] gap-2 px-1 text-xs font-medium text-muted-foreground">
            <span>Product description</span><span>Size</span><span>Units/Box</span><span>Boxes</span><span>Unit price</span><span>Total</span><span />
          </div>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-2 md:grid-cols-[1.6fr_0.8fr_0.9fr_0.6fr_0.9fr_0.9fr_auto] gap-2 rounded-lg border border-border/60 p-2 md:border-0 md:p-0">
              <Input className="col-span-2 md:col-span-1" list="export-product-names" value={it.description} onChange={(e) => patchItem(i, { description: e.target.value })} placeholder="Description" aria-label={`Description ${i + 1}`} />
              <Input value={it.size} onChange={(e) => patchItem(i, { size: e.target.value })} placeholder="e.g. 500g" aria-label={`Size ${i + 1}`} />
              <Input value={it.units_per_box} onChange={(e) => patchItem(i, { units_per_box: e.target.value })} placeholder="e.g. 24" aria-label={`Units per box ${i + 1}`} />
              <Input type="number" min={0} value={it.boxes || ""} onChange={(e) => patchItem(i, { boxes: Number(e.target.value) || 0 })} placeholder="0" aria-label={`Boxes ${i + 1}`} />
              <Input type="number" min={0} value={it.unit_price || ""} onChange={(e) => patchItem(i, { unit_price: Number(e.target.value) || 0 })} placeholder="0.00" aria-label={`Unit price ${i + 1}`} />
              <Input readOnly value={money(lineTotal(it))} className="bg-muted/40" tabIndex={-1} aria-label={`Line total ${i + 1}`} />
              <Button variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={items.length === 1} aria-label={`Remove row ${i + 1}`}><Trash2 className="size-4 text-danger" /></Button>
            </div>
          ))}
          <div className="flex items-center justify-end gap-4 pt-2 border-t border-border/60">
            <span className="text-sm text-muted-foreground">Grand total</span>
            <span className="font-display text-lg font-bold text-brand-dark">{money(total)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Notes + actions */}
      <Card className="shadow-card border-border/60">
        <CardContent className="space-y-3 pt-5">
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <textarea className="min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, shipping terms, etc." />
          </div>
          <div className="flex justify-end">
            <Button variant="brand" onClick={saveAndDownload} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} Save &amp; download PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent */}
      {history.length > 0 && (
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-3"><CardTitle className="font-display text-lg">Recent export invoices</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-3 text-sm">
                <div>
                  <span className="font-medium text-brand-dark">{h.invoice_number}</span>
                  <span className="text-muted-foreground"> · {h.buyer.name || "—"} · {h.invoice_date}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-medium">{formatExportMoney(h.total, h.currency)}</span>
                  <Button variant="outline" size="sm" onClick={() => downloadExportInvoicePdf(h, `${h.invoice_number.replace(/[^\w.-]+/g, "-")}.pdf`)}>
                    <FileDown className="size-4" /> PDF
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

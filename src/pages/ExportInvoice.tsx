import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, FileDown, Loader2 } from "lucide-react";
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
  totalCartons,
  depletionQty,
  formatExportMoney,
  saveExportInvoice,
  downloadExportInvoicePdf,
  type ExportInvoiceItem,
  type ExportInvoiceDraft,
} from "@/lib/exportInvoice";

const CURRENCIES = ["NGN", "USD", "EUR", "GBP", "GHS", "CAD", "ZAR", "KES"];
type Product = { id: string; name: string; stock_quantity: number; unit: string | null; selling_price: number };

const textareaCls = "min-h-[64px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-70";
const selectCls = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";

export default function ExportInvoice() {
  const navigate = useNavigate();
  const { business, role } = useAuth();
  const isOwner = role === "owner";

  const [seller, setSeller] = useState({ name: "", address: "", email: "", phone: "", rc: "" });
  const [bank, setBank] = useState({ bank_name: "", account_name: "", account_number: "", swift: "" });
  const [buyer, setBuyer] = useState({ name: "", address: "", country: "" });
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [shipping, setShipping] = useState({ mode_of_shipment: "", delivery_terms: "", packaging: "", payment_terms: "" });
  const [items, setItems] = useState<ExportInvoiceItem[]>([emptyItem()]);
  const [notes, setNotes] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!business) return;
    setSeller({
      name: business.name || "",
      address: [business.export_address, business.city, business.state].filter(Boolean).join(", "),
      email: business.export_email || "",
      phone: business.export_phone || business.whatsapp_number || "",
      rc: business.export_rc_number || "",
    });
    setBank({
      bank_name: business.export_bank_name || "",
      account_name: business.export_account_name || "",
      account_number: business.export_account_number || "",
      swift: business.export_swift || "",
    });
    setCountry(business.export_country || "");
    setCurrency(business.currency || "NGN");
    supabase.from("products").select("id,name,stock_quantity,unit,selling_price").order("name").then(({ data }) => {
      if (data) setProducts(data as Product[]);
    });
  }, [business]);

  const total = useMemo(() => invoiceTotal(items), [items]);
  const cartons = useMemo(() => totalCartons(items), [items]);
  const money = (n: number) => formatExportMoney(n, currency);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  function patchItem(i: number, patch: Partial<ExportInvoiceItem>) {
    setItems((list) => list.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function pickProduct(i: number, productId: string) {
    const p = productById.get(productId);
    // Prefill the box unit price from the product's inventory selling price (owner can override).
    patchItem(i, {
      product_id: productId || null,
      description: p ? p.name : items[i].description,
      unit_price: p ? (Number(p.selling_price) || 0) : items[i].unit_price,
    });
  }
  const addRow = () => setItems((l) => [...l, emptyItem()]);
  const removeRow = (i: number) => setItems((l) => (l.length === 1 ? l : l.filter((_, idx) => idx !== i)));

  async function saveAndDownload() {
    if (!business) return;
    if (!buyer.name.trim()) return toast.error("Enter the buyer's name");
    const usable = items.filter((it) => it.description.trim() && (Number(it.boxes) || 0) > 0);
    if (usable.length === 0) return toast.error("Add at least one line with a description and boxes");
    // Friendly pre-check (the server enforces this atomically too).
    for (const it of usable) {
      if (!it.product_id) continue;
      const p = productById.get(it.product_id);
      if (p && depletionQty(it) > Number(p.stock_quantity)) return toast.error(`Not enough stock for ${p.name} (needs ${depletionQty(it)}, have ${p.stock_quantity})`);
    }

    setBusy(true);
    try {
      const draft: ExportInvoiceDraft = { invoice_number: "", invoice_date: date, country_of_origin: country.trim(), currency, seller, buyer, shipping, bank, items: usable, notes: notes.trim() };
      const saved = await saveExportInvoice(business.id, draft);
      await downloadExportInvoicePdf(saved, `${saved.invoice_number.replace(/[^\w.-]+/g, "-")}.pdf`);
      toast.success(`Export invoice ${saved.invoice_number} saved`);
      navigate("/export-invoice");
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "Couldn't save the invoice";
      toast.error(msg.includes("INSUFFICIENT_STOCK") ? `Not enough stock for ${msg.split("INSUFFICIENT_STOCK:")[1]?.trim() || "an item"}` : msg);
    } finally {
      setBusy(false);
    }
  }

  const sellerField = (label: string, value: string, onChange: (v: string) => void, placeholder: string, multiline = false) => (
    <div className="space-y-2">
      <Label>{label}</Label>
      {multiline
        ? <textarea className={textareaCls} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={!isOwner} />
        : <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={!isOwner} />}
    </div>
  );

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/export-invoice")} aria-label="Back to export invoices"><ArrowLeft className="size-5" /></Button>
        <div>
          <h1 className="font-display text-2xl lg:text-3xl font-bold text-brand-dark">New Export Invoice</h1>
          <p className="text-muted-foreground text-sm">The number is assigned automatically. Saving depletes the linked product stock.</p>
        </div>
      </div>

      {/* Exporter (seller + bank) */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="font-display text-lg">Exporter (Seller)</CardTitle>
          <CardDescription>{isOwner ? "Prefilled from your Exporter Profile — edit here for this invoice, or change the defaults in Settings." : "Managed by the business owner in Settings."}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sellerField("Company name", seller.name, (v) => setSeller((s) => ({ ...s, name: v })), "Exporter company name")}
          {sellerField("RC number", seller.rc, (v) => setSeller((s) => ({ ...s, rc: v })), "Company registration number")}
          {sellerField("Phone", seller.phone, (v) => setSeller((s) => ({ ...s, phone: v })), "Phone number")}
          {sellerField("Email", seller.email, (v) => setSeller((s) => ({ ...s, email: v })), "exports@example.com")}
          {sellerField("Address", seller.address, (v) => setSeller((s) => ({ ...s, address: v })), "Street, area, city, state", true)}
          {sellerField("Bank name", bank.bank_name, (v) => setBank((b) => ({ ...b, bank_name: v })), "Bank name")}
          {sellerField("Account name", bank.account_name, (v) => setBank((b) => ({ ...b, account_name: v })), "Account holder name")}
          {sellerField("Account number", bank.account_number, (v) => setBank((b) => ({ ...b, account_number: v })), "Account number")}
          {sellerField("SWIFT / IBAN", bank.swift, (v) => setBank((b) => ({ ...b, swift: v })), "SWIFT or IBAN")}
        </CardContent>
      </Card>

      {/* Invoice details + buyer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-3"><CardTitle className="font-display text-lg">Invoice details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <select className={selectCls} value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
                  {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-2"><Label>Country of origin</Label><Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" /></div>
          </CardContent>
        </Card>

        <Card className="shadow-card border-border/60">
          <CardHeader className="pb-3"><CardTitle className="font-display text-lg">Buyer (Importer)</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2"><Label>Buyer name</Label><Input value={buyer.name} onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))} placeholder="Importer company name" /></div>
            <div className="space-y-2"><Label>Buyer address</Label><textarea className={textareaCls} value={buyer.address} onChange={(e) => setBuyer((b) => ({ ...b, address: e.target.value }))} placeholder="Street, city, province, postal code" /></div>
            <div className="space-y-2"><Label>Buyer country</Label><Input value={buyer.country} onChange={(e) => setBuyer((b) => ({ ...b, country: e.target.value }))} placeholder="Country" /></div>
          </CardContent>
        </Card>
      </div>

      {/* Line items */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-3 flex-row items-center justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="font-display text-lg">Products</CardTitle>
            <CardDescription>Unit price (per box) is prefilled from inventory{isOwner ? " — edit it if needed." : "; only the owner can change it."}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={addRow}><Plus className="size-4" /> Add row</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="hidden md:grid grid-cols-[1.7fr_0.7fr_0.8fr_0.6fr_0.9fr_0.9fr_auto] gap-2 px-1 text-xs font-medium text-muted-foreground">
            <span>Product</span><span>Size</span><span>Units/Box</span><span>Boxes</span><span>Unit price</span><span>Total</span><span />
          </div>
          {items.map((it, i) => {
            const p = it.product_id ? productById.get(it.product_id) : undefined;
            const need = depletionQty(it);
            const short = p && need > Number(p.stock_quantity);
            return (
              <div key={i} className="grid grid-cols-2 md:grid-cols-[1.7fr_0.7fr_0.8fr_0.6fr_0.9fr_0.9fr_auto] gap-2 rounded-lg border border-border/60 p-2 md:border-0 md:p-0">
                <div className="col-span-2 md:col-span-1 space-y-1">
                  <select className={selectCls} value={it.product_id ?? ""} onChange={(e) => pickProduct(i, e.target.value)} aria-label={`Product ${i + 1}`}>
                    <option value="">Custom item (no stock impact)</option>
                    {products.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                  </select>
                  {!it.product_id && <Input value={it.description} onChange={(e) => patchItem(i, { description: e.target.value })} placeholder="Description" aria-label={`Description ${i + 1}`} />}
                  {p && <p className={`text-xs ${short ? "text-danger" : "text-muted-foreground"}`}>Stock {p.stock_quantity}{p.unit ? ` ${p.unit}` : ""} · uses {need}</p>}
                </div>
                <Input value={it.size} onChange={(e) => patchItem(i, { size: e.target.value })} placeholder="e.g. 500g" aria-label={`Size ${i + 1}`} />
                <Input type="number" min={0} value={it.units_per_box || ""} onChange={(e) => patchItem(i, { units_per_box: Number(e.target.value) || 0 })} placeholder="e.g. 48" aria-label={`Units per box ${i + 1}`} />
                <Input type="number" min={0} value={it.boxes || ""} onChange={(e) => patchItem(i, { boxes: Number(e.target.value) || 0 })} placeholder="0" aria-label={`Boxes ${i + 1}`} />
                <Input type="number" min={0} value={it.unit_price || ""} onChange={(e) => patchItem(i, { unit_price: Number(e.target.value) || 0 })} placeholder="0.00" aria-label={`Unit price ${i + 1}`} disabled={!isOwner} className="disabled:opacity-70" title={!isOwner ? "Only the owner can change the price" : undefined} />
                <Input readOnly value={money(lineTotal(it))} className="bg-muted/40" tabIndex={-1} aria-label={`Line total ${i + 1}`} />
                <Button variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={items.length === 1} aria-label={`Remove row ${i + 1}`}><Trash2 className="size-4 text-danger" /></Button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-end gap-4 pt-2 border-t border-border/60 text-sm">
            <span className="text-muted-foreground">Total cartons <span className="font-medium text-brand-dark">{cartons}</span></span>
            <span className="text-muted-foreground">Grand total</span>
            <span className="font-display text-lg font-bold text-brand-dark">{money(total)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Shipping + notes */}
      <Card className="shadow-card border-border/60">
        <CardHeader className="pb-3"><CardTitle className="font-display text-lg">Shipping details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-2"><Label>Mode of shipment</Label><Input value={shipping.mode_of_shipment} onChange={(e) => setShipping((s) => ({ ...s, mode_of_shipment: e.target.value }))} placeholder="e.g. Sea Freight" /></div>
          <div className="space-y-2"><Label>Delivery terms (Incoterms)</Label><Input value={shipping.delivery_terms} onChange={(e) => setShipping((s) => ({ ...s, delivery_terms: e.target.value }))} placeholder="e.g. EXW, FOB, CIF" /></div>
          <div className="space-y-2"><Label>Packaging</Label><Input value={shipping.packaging} onChange={(e) => setShipping((s) => ({ ...s, packaging: e.target.value }))} placeholder="e.g. Export-grade sealed cartons" /></div>
          <div className="space-y-2"><Label>Payment terms</Label><Input value={shipping.payment_terms} onChange={(e) => setShipping((s) => ({ ...s, payment_terms: e.target.value }))} placeholder="e.g. 50% on arrival" /></div>
          <div className="space-y-2 sm:col-span-2"><Label>Notes (optional)</Label><textarea className={textareaCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything else to appear on the invoice" /></div>
          <div className="sm:col-span-2 flex justify-end">
            <Button variant="brand" onClick={saveAndDownload} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} Save &amp; download PDF
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

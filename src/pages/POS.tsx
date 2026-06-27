import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Plus, Minus, Trash2, ShoppingCart, Banknote, Smartphone, CreditCard, CheckCircle2, ClipboardList, ScanLine, Printer, MessageCircle, BarChart2, AlertTriangle, PauseCircle } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import OrdersPanel from "@/components/OrdersPanel";
import Paginator, { usePagination } from "@/components/Paginator";
import { invoiceFallbackNumber } from "@/lib/invoiceNumber";
import { buildReceiptMessage } from "@/lib/whatsapp";
import WhatsAppShareDialog from "@/components/WhatsAppShareDialog";
import { POSSkeleton } from "@/components/Skeletons";
import ConfirmDialog from "@/components/ConfirmDialog";
import { summarizeHeldSale, heldItemsPreview, parseHeldSales, serializeHeldSales, heldStorageKey, reconcileHeldItems, type HeldSale } from "@/lib/heldSales";

type Product = { id: string; name: string; sku: string | null; selling_price: number; stock_quantity: number; reorder_level: number; category: string | null };
type CartItem = { product: Product; qty: number };

const methods = [
  { id: "cash", label: "Cash", icon: Banknote },
  { id: "transfer", label: "Transfer", icon: Smartphone },
  { id: "pos", label: "POS Terminal", icon: CreditCard },
];

type EodData = { total: number; count: number; byMethod: Record<string, number>; topProduct: string };

export default function POS() {
  const { business, user, profile, role } = useAuth();
  const { fmt, symbol } = useCurrency();
  const { fmtDateTime } = useDateFormat();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [method, setMethod] = useState("cash");
  const [discount, setDiscount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<{ total: number; discount: number; items: CartItem[]; method: string; number?: string | null } | null>(null);
  const [eod, setEod] = useState<EodData | null>(null);
  const [waShare, setWaShare] = useState<{ message: string } | null>(null);
  const [held, setHeld] = useState<HeldSale[]>([]);
  const [heldOpen, setHeldOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  const heldKey = business ? heldStorageKey(business.id) : null;

  useEffect(() => {
    if (heldKey) setHeld(parseHeldSales(localStorage.getItem(heldKey)));
  }, [heldKey]);

  const persistHeld = (next: HeldSale[]) => {
    setHeld(next);
    if (heldKey) localStorage.setItem(heldKey, serializeHeldSales(next));
  };

  const load = async () => {
    const { data } = await supabase.from("products").select("id,name,sku,selling_price,stock_quantity,reorder_level,category").gt("stock_quantity", 0).order("name");
    setProducts((data as Product[]) || []);
    setLoading(false);
  };

  useEffect(() => { if (business) load(); }, [business]);

  const filtered = useMemo(
    () => products.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase())),
    [products, q]
  );
  const { paged, page, setPage, pageSize, setPageSize, pageCount, total: productCount } = usePagination(filtered, 20);

  if (loading) return <POSSkeleton />;

  const addToCart = (p: Product) => {
    setCart(prev => {
      const found = prev.find(i => i.product.id === p.id);
      if (found) {
        if (found.qty + 1 > Number(p.stock_quantity)) {
          toast.error("Not enough stock");
          return prev;
        }
        return prev.map(i => i.product.id === p.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { product: p, qty: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart(prev => prev.flatMap(i => {
      if (i.product.id !== id) return [i];
      const next = i.qty + delta;
      if (next <= 0) return [];
      if (next > Number(i.product.stock_quantity)) { toast.error("Not enough stock"); return [i]; }
      return [{ ...i, qty: next }];
    }));
  };

  const setQty = (id: string, value: number) => {
    setCart(prev => prev.map(i => {
      if (i.product.id !== id) return i;
      const max = Number(i.product.stock_quantity);
      let q = Math.floor(value);
      if (!q || q < 1) q = 1;
      if (q > max) { toast.error("Not enough stock"); q = max; }
      return { ...i, qty: q };
    }));
  };

  const remove = (id: string) => setCart(prev => prev.filter(i => i.product.id !== id));

  const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const holdSale = () => {
    if (cart.length === 0) return;
    persistHeld([{ id: newId(), createdAt: new Date().toISOString(), items: cart, discount }, ...held]);
    setCart([]);
    setDiscount(0);
    toast.success("Sale held");
  };

  const resumeHeld = (sale: HeldSale) => {
    let next = held.filter(s => s.id !== sale.id);
    if (cart.length > 0) {
      next = [{ id: newId(), createdAt: new Date().toISOString(), items: cart, discount }, ...next];
      toast.success("Current sale held");
    }
    persistHeld(next);

    // The held cart captured stock at hold time, which may be stale now (the item could
    // have sold in between). Reconcile against the live product list: drop items that are
    // no longer in stock and cap quantities to what's actually available.
    const live = new Map(products.map(p => [p.id, p]));
    const { items: reconciled, removed, capped } = reconcileHeldItems(sale.items as CartItem[], live);
    setCart(reconciled);
    setDiscount(reconciled.length > 0 ? sale.discount : 0);
    setHeldOpen(false);
    if (removed || capped) {
      const parts = [
        removed && `${removed} item${removed === 1 ? "" : "s"} now out of stock`,
        capped && `${capped} reduced to available stock`,
      ].filter(Boolean);
      toast.warning(`Resumed with changes: ${parts.join(", ")}.`);
    }
  };

  const discardHeld = (id: string) => persistHeld(held.filter(s => s.id !== id));

  const clearCart = () => { setCart([]); setDiscount(0); setClearConfirm(false); };

  const subtotal = cart.reduce((a, i) => a + i.qty * Number(i.product.selling_price), 0);
  const total = Math.max(0, subtotal - discount);

  const checkout = async () => {
    if (!business || cart.length === 0) return;
    setBusy(true);

    // Deduct stock first, atomically and guarded against overselling. This is the source
    // of truth for availability — the cart's stock numbers can be stale (e.g. a held sale
    // resumed after the same item sold elsewhere), so we never trust them to gate the sale.
    const stockItems = cart.map(i => ({ product_id: i.product.id, qty: i.qty }));
    const { error: eStock } = await supabase.rpc("deduct_sale_stock" as any, { _business_id: business.id, _items: stockItems });
    if (eStock) {
      setBusy(false);
      if (eStock.message?.includes("INSUFFICIENT_STOCK")) {
        const name = eStock.message.split("INSUFFICIENT_STOCK:")[1]?.trim() || "an item";
        toast.error(`Not enough stock for ${name} — it may have just sold. Refreshing availability.`);
      } else {
        toast.error(eStock.message || "Could not reserve stock");
      }
      load();
      return;
    }

    const { data: sale, error: e1 } = await supabase
      .from("sales")
      .insert({ business_id: business.id, staff_id: user?.id, total_amount: total, discount_amount: discount, payment_method: method })
      .select().single();
    if (e1 || !sale) {
      // Roll back the stock we already took, since no sale was recorded.
      await supabase.rpc("restock_sale_stock" as any, { _business_id: business.id, _items: stockItems });
      setBusy(false);
      load();
      return toast.error(e1?.message || "Sale failed");
    }

    const items = cart.map(i => ({
      sale_id: sale.id,
      product_id: i.product.id,
      quantity: i.qty,
      unit_price: Number(i.product.selling_price),
    }));
    const { error: e2 } = await supabase.from("sale_items").insert(items);
    if (e2) {
      // Undo: drop the sale (cascades sale_items) and return the stock.
      await supabase.from("sales").delete().eq("id", sale.id);
      await supabase.rpc("restock_sale_stock" as any, { _business_id: business.id, _items: stockItems });
      setBusy(false);
      load();
      return toast.error(e2.message);
    }

    // Auto-create a paid invoice for this sale
    const { data: numData } = await supabase.rpc("next_invoice_number" as any, { _business_id: business.id });
    const { data: inv, error: e3 } = await supabase.from("invoices").insert({
      business_id: business.id,
      invoice_number: (numData as string) || invoiceFallbackNumber(),
      customer_name: "Walk-in Customer",
      status: "paid",
      subtotal,
      discount_amount: discount,
      total,
      sale_id: sale.id,
      created_by: user?.id ?? null,
      issue_date: new Date().toISOString().slice(0, 10),
    } as any).select().single();
    if (e3) {
      toast.error(`Invoice creation failed: ${e3.message}`);
    } else if (inv) {
      const invItems = cart.map(i => ({
        invoice_id: inv.id,
        description: i.product.name,
        quantity: i.qty,
        unit_price: Number(i.product.selling_price),
        line_total: i.qty * Number(i.product.selling_price),
      }));
      const { error: e4 } = await supabase.from("invoice_items").insert(invItems);
      if (e4) {
        // Backfill from sale_items as a fallback so the invoice view still shows items
        console.error("invoice_items insert failed, attempting backfill:", e4.message);
        await supabase.from("invoice_items").delete().eq("invoice_id", inv.id);
        await supabase.from("sale_items")
          .select("quantity,unit_price,products(name)")
          .eq("sale_id", sale.id)
          .then(({ data: si }) => {
            if (!si?.length) return;
            supabase.from("invoice_items").insert(
              (si as any[]).map(r => ({
                invoice_id: inv.id,
                description: r.products?.name || "Item",
                quantity: Number(r.quantity),
                unit_price: Number(r.unit_price),
                line_total: Number(r.quantity) * Number(r.unit_price),
              }))
            );
          });
      }
    }

    setBusy(false);
    setReceipt({ total, discount, items: [...cart], method, number: inv?.invoice_number ?? null });
    setCart([]);
    setDiscount(0);
    load();
  };

  const openEod = async () => {
    if (!business) return;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const { data: todaySales } = await supabase
      .from("sales")
      .select("id,total_amount,payment_method,sale_items(product_id,quantity,products(name))")
      .eq("business_id", business.id)
      .eq("voided", false)
      .gte("created_at", todayStart.toISOString());

    if (!todaySales) return;
    const byMethod: Record<string, number> = {};
    const prodQty: Record<string, { name: string; qty: number }> = {};
    let total = 0;
    for (const s of todaySales as any[]) {
      total += Number(s.total_amount);
      const m = s.payment_method || "other";
      byMethod[m] = (byMethod[m] || 0) + Number(s.total_amount);
      for (const si of s.sale_items || []) {
        const pid = si.product_id;
        const name = si.products?.name || "Unknown";
        if (!prodQty[pid]) prodQty[pid] = { name, qty: 0 };
        prodQty[pid].qty += Number(si.quantity);
      }
    }
    const topProduct = Object.values(prodQty).sort((a, b) => b.qty - a.qty)[0]?.name || "—";
    setEod({ total, count: todaySales.length, byMethod, topProduct });
  };

  return (
    <div className="space-y-6 w-full">
      <Tabs defaultValue="sale" className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold text-brand-dark">Point of Sale</h1>
            <p className="text-muted-foreground mt-1 text-sm md:text-base">Walk-in sales and online / phone orders.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TabsList className="grid grid-cols-2">
              <TabsTrigger value="sale" className="gap-2"><ShoppingCart className="size-4" /> Sale</TabsTrigger>
              <TabsTrigger value="orders" className="gap-2"><ClipboardList className="size-4" /> Orders</TabsTrigger>
            </TabsList>
            {held.length > 0 && (
              <Button variant="outline" size="sm" className="border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800" onClick={() => setHeldOpen(true)}>
                <ClipboardList className="size-4 mr-1" /> Held sales ({held.length})
              </Button>
            )}
            {(role === "owner" || role === "manager") && (
              <Button variant="outline" size="sm" onClick={openEod}>
                <BarChart2 className="size-4 mr-1" /> End of Day
              </Button>
            )}
          </div>
        </div>

        <TabsContent value="sale" className="mt-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
            {/* Product grid */}
            <div className="space-y-4 min-w-0">
              <div className="grid sm:grid-cols-[1fr,260px] gap-2">
                <div className="relative">
                  <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Search products..." className="pl-9 h-11 bg-card" />
                </div>
                <div className="relative">
                  <ScanLine className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Scan or type SKU + Enter"
                    className="pl-9 h-11 bg-card font-mono"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const v = (e.currentTarget.value || "").trim();
                      if (!v) return;
                      const hit = products.find(p => p.sku && p.sku.toLowerCase() === v.toLowerCase())
                        ?? products.find(p => p.name.toLowerCase() === v.toLowerCase());
                      if (hit) { addToCart(hit); e.currentTarget.value = ""; }
                      else toast.error(`No product with SKU "${v}"`);
                    }}
                  />
                </div>
              </div>

              {filtered.length === 0 ? (
                <Card className="p-12 text-center shadow-card border-border/60">
                  <p className="text-muted-foreground">No products in stock. Add some from the Inventory screen.</p>
                </Card>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                    {paged.map(p => {
                      const low = Number(p.stock_quantity) <= Number(p.reorder_level);
                      return (
                      <button
                        key={p.id}
                        onClick={() => addToCart(p)}
                        className={`group text-left p-4 rounded-xl bg-card border shadow-card hover:shadow-elevated hover:-translate-y-0.5 transition-all ${low ? "border-warning/40 hover:border-warning" : "border-border/60 hover:border-brand/40"}`}
                      >
                        <div className="size-12 rounded-lg bg-gradient-brand mb-3 grid place-items-center text-brand-foreground font-display font-bold text-lg">
                          {p.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="font-medium text-sm text-brand-dark line-clamp-2 min-h-[2.5em]">{p.name}</div>
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mt-2">
                          <div className="font-display font-bold text-brand">{fmt(p.selling_price)}</div>
                          <Badge
                            variant="outline"
                            title={low ? "Low stock" : undefined}
                            className={`text-xs gap-1 ${low ? "bg-warning/10 text-warning border-warning/20" : "bg-secondary"}`}
                          >
                            {low && <AlertTriangle className="size-3" />}{Number(p.stock_quantity)} left
                          </Badge>
                        </div>
                      </button>
                      );
                    })}
                  </div>
                  {pageCount > 1 && (
                    <Paginator page={page} pageCount={pageCount} pageSize={pageSize} total={productCount} onPageChange={setPage} onPageSizeChange={setPageSize} />
                  )}
                </>
              )}
            </div>

            {/* Cart */}
            <Card className="shadow-elevated border-border/60 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] flex flex-col min-w-0">
              <div className="p-5 border-b border-border flex items-center gap-2">
                <ShoppingCart className="size-4 text-brand" />
                <h2 className="font-display font-semibold text-brand-dark">Active Sale</h2>
                <Badge variant="outline" className="ml-auto bg-brand-light text-brand-dark border-brand/20">{cart.length} item{cart.length === 1 ? "" : "s"}</Badge>
              </div>

              {cart.length > 0 && (
                <div className="px-3 pt-3 flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={holdSale}><PauseCircle className="size-4 mr-1" /> Hold sale</Button>
                  {cart.length > 1 && <Button variant="outline" size="sm" className="flex-1 text-muted-foreground hover:text-destructive" onClick={() => setClearConfirm(true)}><Trash2 className="size-4 mr-1" /> Clear all</Button>}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px]">
                {cart.length === 0 ? (
                  <div className="h-full grid place-items-center text-center p-6">
                    <div>
                      <div className="size-12 rounded-xl bg-secondary text-muted-foreground grid place-items-center mx-auto mb-3">
                        <ShoppingCart className="size-5" />
                      </div>
                      <p className="text-sm text-muted-foreground">Cart is empty</p>
                    </div>
                  </div>
                ) : cart.map(i => (
                  <div key={i.product.id} className="p-3 rounded-lg bg-secondary/50 flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="flex-1 min-w-[96px]">
                      <div className="font-medium text-sm truncate text-brand-dark">{i.product.name}</div>
                      <div className="text-xs text-muted-foreground">{fmt(i.product.selling_price)} each</div>
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => updateQty(i.product.id, -1)}><Minus className="size-3" /></Button>
                        <Input type="number" min={1} max={Number(i.product.stock_quantity)} value={i.qty} onChange={e => setQty(i.product.id, Number(e.target.value))} className="w-12 h-7 px-1 text-center text-sm font-medium" />
                        <Button variant="ghost" size="icon" className="size-7" onClick={() => updateQty(i.product.id, 1)}><Plus className="size-3" /></Button>
                      </div>
                      <div className="font-display font-semibold text-sm text-brand-dark text-right whitespace-nowrap">{fmt(i.qty * Number(i.product.selling_price))}</div>
                      <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-destructive" onClick={() => remove(i.product.id)}><Trash2 className="size-3" /></Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-5 border-t border-border space-y-4 bg-gradient-soft">
                {cart.length > 0 && (
                  <div className="flex items-center gap-3">
                    <label className="text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Discount ({symbol})</label>
                    <Input
                      type="number"
                      min="0"
                      max={subtotal}
                      step="0.01"
                      value={discount || ""}
                      onChange={e => setDiscount(Math.min(Number(e.target.value) || 0, subtotal))}
                      placeholder="0"
                      className="h-8 text-sm"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Payment method</div>
                  <div className="grid grid-cols-3 gap-2">
                    {methods.map(m => (
                      <button
                        key={m.id}
                        onClick={() => setMethod(m.id)}
                        className={`p-2.5 rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1 ${
                          method === m.id ? "bg-brand text-brand-foreground border-brand shadow-brand" : "bg-card border-border hover:border-brand/40"
                        }`}
                      >
                        <m.icon className="size-4" />
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2 border-t border-border/60 space-y-1">
                  {discount > 0 && (
                    <>
                      <div className="flex items-baseline justify-between text-sm">
                        <div className="text-muted-foreground">Subtotal</div>
                        <div className="text-muted-foreground">{fmt(subtotal)}</div>
                      </div>
                      <div className="flex items-baseline justify-between text-sm">
                        <div className="text-muted-foreground">Discount</div>
                        <div className="text-danger">-{fmt(discount)}</div>
                      </div>
                    </>
                  )}
                  <div className="flex items-baseline justify-between">
                    <div className="text-sm text-muted-foreground">Total</div>
                    <div className="font-display text-3xl font-bold text-brand-dark">{fmt(total)}</div>
                  </div>
                </div>

                <Button variant="hero" size="lg" className="w-full" disabled={cart.length === 0 || busy} onClick={checkout}>
                  {busy ? "Processing..." : "Complete sale"}
                </Button>
              </div>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="orders" className="mt-6">
          <OrdersPanel products={products} onStockChanged={load} />
        </TabsContent>
      </Tabs>

      {/* Held sales */}
      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Held sales</DialogTitle>
          </DialogHeader>
          {held.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No held sales.</p>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {held.map(s => {
                const sum = summarizeHeldSale(s);
                return (
                  <div key={s.id} className="p-3 rounded-lg bg-secondary/50 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-brand-dark">{fmt(sum.total)} · {sum.count} item{sum.count === 1 ? "" : "s"}</div>
                      <div className="text-xs text-muted-foreground truncate">{heldItemsPreview(s.items)}</div>
                      <div className="text-[11px] text-muted-foreground">{fmtDateTime(s.createdAt)}</div>
                    </div>
                    <Button size="sm" onClick={() => resumeHeld(s)}>Resume</Button>
                    <Button size="icon" variant="ghost" className="size-8 text-muted-foreground hover:text-destructive" aria-label="Discard held sale" onClick={() => discardHeld(s.id)}><Trash2 className="size-4" /></Button>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={clearConfirm}
        onOpenChange={setClearConfirm}
        title="Clear all items?"
        description="This removes every item from the current sale. Held sales are not affected."
        confirmLabel="Clear all"
        variant="destructive"
        onConfirm={clearCart}
      />

      {/* End of Day summary */}
      <Dialog open={!!eod} onOpenChange={(o) => !o && setEod(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="size-14 rounded-full bg-brand-light text-brand grid place-items-center mx-auto mb-2">
              <BarChart2 className="size-7" />
            </div>
            <DialogTitle className="font-display text-center text-2xl">End of Day Summary</DialogTitle>
          </DialogHeader>
          {eod && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-brand-light text-center">
                  <div className="text-xs text-muted-foreground mb-1">Total Revenue</div>
                  <div className="font-display font-bold text-lg text-brand">{fmt(eod.total)}</div>
                </div>
                <div className="p-3 rounded-lg bg-secondary text-center">
                  <div className="text-xs text-muted-foreground mb-1">Transactions</div>
                  <div className="font-display font-bold text-lg text-brand-dark">{eod.count}</div>
                </div>
              </div>
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Revenue by payment method</div>
                {Object.entries(eod.byMethod).map(([m, v]) => (
                  <div key={m} className="flex justify-between items-center p-2 rounded-lg bg-secondary/50">
                    <span className="capitalize">{m}</span>
                    <span className="font-medium">{fmt(v)}</span>
                  </div>
                ))}
                {Object.keys(eod.byMethod).length === 0 && (
                  <div className="text-muted-foreground">No sales today.</div>
                )}
              </div>
              <div className="p-3 rounded-lg bg-secondary/50">
                <div className="text-xs text-muted-foreground mb-1">Top product today</div>
                <div className="font-medium text-brand-dark">{eod.topProduct}</div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Receipt */}
      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="size-14 rounded-full bg-brand-light text-brand grid place-items-center mx-auto mb-2">
              <CheckCircle2 className="size-7" />
            </div>
            <DialogTitle className="font-display text-center text-2xl">Sale Complete</DialogTitle>
          </DialogHeader>
          {receipt && (() => {
            const date = fmtDateTime(new Date());
            const bizName = business?.name || "Receipt";
            const receiptSubtotal = receipt.items.reduce((a, i) => a + i.qty * Number(i.product.selling_price), 0);
            const printReceipt = () => {
              const html = `<!doctype html><html><head><title>Receipt</title><style>
                body{font-family:ui-monospace,Menlo,monospace;width:280px;margin:16px auto;color:#111}
                h1{font-size:16px;text-align:center;margin:0 0 4px}
                .muted{color:#666;text-align:center;font-size:12px}
                hr{border:none;border-top:1px dashed #999;margin:8px 0}
                .row{display:flex;justify-content:space-between;font-size:12px;margin:2px 0}
                .total{font-size:16px;font-weight:bold;margin-top:6px}
                .foot{text-align:center;font-size:11px;color:#666;margin-top:8px}
              </style></head><body>
                <h1>${bizName}</h1><div class="muted">${date}</div><hr/>
                ${receipt.items.map(i => `<div class="row"><span>${i.qty} × ${i.product.name}</span><span>${fmt(i.qty * Number(i.product.selling_price))}</span></div>`).join("")}
                <hr/>
                <div class="row total"><span>TOTAL</span><span>${fmt(receipt.total)}</span></div>
                <div class="muted">Paid via ${receipt.method}</div>
                <div class="foot">${profile?.owner_name ? `Served by ${profile.owner_name}<br/>` : ""}Thank you for your patronage</div>
                <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}</script>
              </body></html>`;
              const w = window.open("", "_blank", "width=320,height=600");
              if (!w) return toast.error("Allow pop-ups to print");
              w.document.write(html); w.document.close();
            };
            const shareWa = () => setWaShare({
              message: buildReceiptMessage({
                businessName: bizName,
                date,
                invoiceNumber: receipt.number,
                items: receipt.items.map(i => ({ qty: i.qty, name: i.product.name, lineTotal: i.qty * Number(i.product.selling_price) })),
                subtotal: receiptSubtotal,
                discount: receipt.discount,
                total: receipt.total,
                method: receipt.method,
                servedBy: profile?.owner_name,
                fmt,
              }),
            });

            return (
              <div className="space-y-3">
                <div className="text-center">
                  <div className="font-display text-4xl font-bold text-brand-dark">{fmt(receipt.total)}</div>
                  {receipt.discount > 0 && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {fmt(receiptSubtotal)} − {fmt(receipt.discount)} discount
                    </div>
                  )}
                  <div className="text-sm text-muted-foreground capitalize mt-1">paid via {receipt.method}</div>
                </div>
                <div className="border-t border-dashed border-border pt-3 space-y-1.5 text-sm max-h-48 overflow-y-auto">
                  {receipt.items.map(i => (
                    <div key={i.product.id} className="flex justify-between">
                      <span className="text-muted-foreground">{i.qty} × {i.product.name}</span>
                      <span className="font-medium">{fmt(i.qty * Number(i.product.selling_price))}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={printReceipt}><Printer className="size-4" /> Print</Button>
                  <Button variant="outline" onClick={shareWa}><MessageCircle className="size-4" /> WhatsApp</Button>
                </div>
                <Button variant="brand" className="w-full" onClick={() => setReceipt(null)}>New sale</Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      <WhatsAppShareDialog
        open={!!waShare}
        onOpenChange={(o) => !o && setWaShare(null)}
        message={waShare?.message ?? ""}
        recipientLabel="Customer"
      />
    </div>
  );
}

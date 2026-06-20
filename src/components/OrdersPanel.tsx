import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Minus, Trash2, Phone, Globe, Package, Truck, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { toast } from "sonner";
import Paginator, { usePagination } from "@/components/Paginator";
import SearchableSelect from "@/components/SearchableSelect";
import ConfirmDialog from "@/components/ConfirmDialog";

type Product = { id: string; name: string; selling_price: number; stock_quantity: number; category: string | null };
type OrderItem = { id?: string; product_id: string; product_name?: string; quantity: number; unit_price: number };
type Order = {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  channel: string;
  payment_method: string;
  status: string;
  notes: string | null;
  total_amount: number;
  stock_deducted: boolean;
  created_at: string;
  order_items?: OrderItem[];
};

const STATUSES = ["pending", "shipped", "delivered", "cancelled"];

const statusMeta: Record<string, { icon: any; cls: string; label: string }> = {
  pending: { icon: Clock, cls: "bg-amber-100 text-amber-800 border-amber-200", label: "Pending" },
  shipped: { icon: Truck, cls: "bg-blue-100 text-blue-800 border-blue-200", label: "Shipped" },
  delivered: { icon: CheckCircle2, cls: "bg-brand-light text-brand-dark border-brand/20", label: "Delivered" },
  cancelled: { icon: XCircle, cls: "bg-rose-100 text-rose-800 border-rose-200", label: "Cancelled" },
};

export default function OrdersPanel({ products, onStockChanged }: { products: Product[]; onStockChanged: () => void }) {
  const { business, user } = useAuth();
  const { fmt } = useCurrency();
  const { fmtDateTime } = useDateFormat();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);

  // form state
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [channel, setChannel] = useState("online");
  const [payment, setPayment] = useState("cash");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<OrderItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("*, order_items(id,product_id,quantity,unit_price)")
      .order("created_at", { ascending: false });
    setOrders((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { if (business) load(); }, [business]);

  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);

  const filtered = filter === "all" ? orders : orders.filter(o => o.status === filter);
  const { paged, page, setPage, pageSize, setPageSize, pageCount, total: orderCount } = usePagination(filtered, 20);

  const itemsTotal = items.reduce((a, i) => a + i.quantity * i.unit_price, 0);

  const addItem = (productId: string) => {
    const p = productMap[productId];
    if (!p) return;
    setItems(prev => {
      const found = prev.find(i => i.product_id === productId);
      if (found) return prev.map(i => i.product_id === productId ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product_id: productId, product_name: p.name, quantity: 1, unit_price: Number(p.selling_price) }];
    });
  };

  const updateItemQty = (id: string, delta: number) =>
    setItems(prev => prev.flatMap(i => {
      if (i.product_id !== id) return [i];
      const next = i.quantity + delta;
      return next <= 0 ? [] : [{ ...i, quantity: next }];
    }));

  const setItemQty = (id: string, value: number) =>
    setItems(prev => prev.map(i => {
      if (i.product_id !== id) return i;
      const q = Math.floor(value);
      return { ...i, quantity: !q || q < 1 ? 1 : q };
    }));

  const resetForm = () => {
    setCustomer(""); setPhone(""); setChannel("online"); setPayment("cash"); setNotes(""); setItems([]);
  };

  const createOrder = async () => {
    if (!business || !customer.trim() || items.length === 0) {
      return toast.error("Add a customer and at least one item");
    }
    setSaving(true);
    const { data: order, error: e1 } = await supabase.from("orders").insert({
      business_id: business.id,
      staff_id: user?.id,
      customer_name: customer.trim(),
      customer_phone: phone.trim() || null,
      channel, payment_method: payment,
      notes: notes.trim() || null,
      total_amount: itemsTotal,
      status: "pending",
    }).select().single();
    if (e1 || !order) { setSaving(false); return toast.error(e1?.message || "Failed"); }

    const rows = items.map(i => ({ order_id: order.id, product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price }));
    const { error: e2 } = await supabase.from("order_items").insert(rows);
    if (e2) { setSaving(false); return toast.error(e2.message); }

    setSaving(false);
    setOpen(false);
    resetForm();
    toast.success("Order created");
    load();
  };

  const updateStatus = async (order: Order, newStatus: string) => {
    if (newStatus === order.status) return;
    // Guard: shipping requires stock
    if (newStatus === "shipped" && !order.stock_deducted) {
      for (const it of order.order_items || []) {
        const p = productMap[it.product_id];
        if (p && Number(p.stock_quantity) < Number(it.quantity)) {
          return toast.error(`Not enough stock for ${p.name}`);
        }
      }
    }
    const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", order.id);
    if (error) return toast.error(error.message);
    toast.success(`Order marked ${newStatus}`);
    load();
    if (newStatus === "shipped") onStockChanged();
  };

  const deleteOrder = (o: Order) => {
    setPending({
      title: `Delete order for ${o.customer_name}?`,
      description: "This order and all its items will be permanently deleted.",
      onConfirm: async () => {
        const { error } = await supabase.from("orders").delete().eq("id", o.id);
        if (error) return toast.error(error.message);
        toast.success("Order deleted");
        load();
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex flex-wrap gap-2">
          {["all", ...STATUSES].map(s => (
            <button
              key={s}
              onClick={() => { setFilter(s); setPage(1); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize border transition-colors ${
                filter === s ? "bg-brand text-brand-foreground border-brand" : "bg-card border-border text-muted-foreground hover:border-brand/40"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button variant="brand"><Plus className="size-4" /> New order</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-display">Create order</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <Label>Customer name</Label>
                  <Input value={customer} onChange={e => setCustomer(e.target.value)} placeholder="e.g. Adaeze O." />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="08012345678" />
                </div>
                <div>
                  <Label>Channel</Label>
                  <SearchableSelect
                    value={channel}
                    onValueChange={setChannel}
                    options={[
                      { value: "online", label: "Online" },
                      { value: "phone", label: "Phone call" },
                    ]}
                  />
                </div>
                <div>
                  <Label>Payment method</Label>
                  <SearchableSelect
                    value={payment}
                    onValueChange={setPayment}
                    options={[
                      { value: "cash", label: "Cash on delivery" },
                      { value: "transfer", label: "Bank transfer" },
                      { value: "pos", label: "POS terminal" },
                    ]}
                  />
                </div>
              </div>

              <div>
                <Label>Add product</Label>
                <SearchableSelect
                  value=""
                  onValueChange={addItem}
                  placeholder="Pick a product..."
                  emptyText="No products in stock"
                  options={products.map(p => ({
                    value: p.id,
                    label: `${p.name} — ${fmt(p.selling_price)} (${Number(p.stock_quantity)} in stock)`,
                  }))}
                />
              </div>

              {items.length > 0 && (
                <div className="space-y-2 border border-border/60 rounded-lg p-3 bg-secondary/30">
                  {items.map(i => (
                    <div key={i.product_id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{i.product_name}</div>
                        <div className="text-xs text-muted-foreground">{fmt(i.unit_price)} each</div>
                      </div>
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => updateItemQty(i.product_id, -1)}><Minus className="size-3" /></Button>
                      <Input type="number" min={1} value={i.quantity} onChange={e => setItemQty(i.product_id, Number(e.target.value))} className="w-12 h-7 px-1 text-center text-sm font-medium" />
                      <Button variant="ghost" size="icon" className="size-7" onClick={() => updateItemQty(i.product_id, 1)}><Plus className="size-3" /></Button>
                      <div className="w-20 text-right text-sm font-semibold">{fmt(i.unit_price * i.quantity)}</div>
                    </div>
                  ))}
                  <div className="flex justify-between pt-2 border-t border-border/60">
                    <span className="text-sm text-muted-foreground">Total</span>
                    <span className="font-display font-bold text-brand-dark">{fmt(itemsTotal)}</span>
                  </div>
                </div>
              )}

              <div>
                <Label>Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Delivery address, special instructions..." rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="brand" onClick={createOrder} disabled={saving}>{saving ? "Saving..." : "Create order"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <Card className="p-12 text-center text-muted-foreground">Loading orders…</Card>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center shadow-card border-border/60">
          <div className="size-12 rounded-xl bg-secondary text-muted-foreground grid place-items-center mx-auto mb-3">
            <Package className="size-5" />
          </div>
          <p className="text-muted-foreground">No orders yet. Create one above.</p>
        </Card>
      ) : (
        <>
        <div className="grid gap-3">
          {paged.map(o => {
            const meta = statusMeta[o.status] || statusMeta.pending;
            const Icon = meta.icon;
            const ChannelIcon = o.channel === "phone" ? Phone : Globe;
            return (
              <Card key={o.id} className="p-4 shadow-card border-border/60">
                <div className="flex flex-wrap items-start gap-3 justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display font-semibold text-brand-dark">{o.customer_name}</span>
                      <Badge variant="outline" className="gap-1 text-xs">
                        <ChannelIcon className="size-3" /> {o.channel}
                      </Badge>
                      <Badge variant="outline" className={`gap-1 text-xs ${meta.cls}`}>
                        <Icon className="size-3" /> {meta.label}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {o.customer_phone && <>{o.customer_phone} · </>}
                      {fmtDateTime(o.created_at)}
                    </div>
                    {o.notes && <div className="text-xs text-muted-foreground mt-1 italic">"{o.notes}"</div>}
                  </div>
                  <div className="text-right">
                    <div className="font-display text-xl font-bold text-brand-dark">{fmt(o.total_amount)}</div>
                    <div className="text-xs text-muted-foreground capitalize">{o.payment_method}</div>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-border/60 flex flex-wrap items-center gap-2">
                  <div className="text-xs text-muted-foreground flex-1 min-w-[140px]">
                    {(o.order_items || []).map(it => `${it.quantity}× ${productMap[it.product_id]?.name || "item"}`).join(", ")}
                  </div>
                  <SearchableSelect
                    value={o.status}
                    onValueChange={(v) => updateStatus(o, v)}
                    className="h-9 w-[140px]"
                    options={STATUSES.map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
                  />
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => deleteOrder(o)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
        {pageCount > 1 && (
          <Paginator page={page} pageCount={pageCount} pageSize={pageSize} total={orderCount} onPageChange={setPage} onPageSizeChange={setPageSize} />
        )}
        </>
      )}

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

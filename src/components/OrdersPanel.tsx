import { useEffect, useMemo, useState } from "react";
import Hint from "@/components/Hint";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Minus, Trash2, Pencil, Phone, Globe, Package, Truck, CheckCircle2, XCircle, Clock, FileText, MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useCurrency } from "@/hooks/useCurrency";
import { useDateFormat } from "@/hooks/useDateFormat";
import { toast } from "sonner";
import Paginator, { usePagination } from "@/components/Paginator";
import SearchableSelect from "@/components/SearchableSelect";
import ConfirmDialog from "@/components/ConfirmDialog";
import { orderStatusOptions, isOrderLocked } from "@/lib/orderStatus";

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
  discount_amount: number;
  stock_deducted: boolean;
  invoice_id: string | null;
  created_at: string;
  order_items?: OrderItem[];
  invoice?: { invoice_number: string } | null;
};

const STATUSES = ["pending", "shipped", "delivered", "cancelled"];

const statusMeta: Record<string, { icon: any; cls: string; label: string }> = {
  pending: { icon: Clock, cls: "bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60", label: "Pending" },
  shipped: { icon: Truck, cls: "bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800/60", label: "Shipped" },
  delivered: { icon: CheckCircle2, cls: "bg-brand-light text-brand-dark border-brand/20", label: "Delivered" },
  cancelled: { icon: XCircle, cls: "bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-800/60", label: "Cancelled" },
};

export default function OrdersPanel({ products, onStockChanged }: { products: Product[]; onStockChanged: () => void }) {
  const { business, user, can } = useAuth();
  const { fmt, symbol } = useCurrency();
  const { fmtDateTime } = useDateFormat();
  const canManage = can("pos", "orders_delete");
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
  const [discount, setDiscount] = useState(0);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [pending, setPending] = useState<{ title: string; description: string; confirmLabel?: string; variant?: "destructive" | "default"; onConfirm: () => void } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select("*, order_items(id,product_id,quantity,unit_price), invoice:invoices!orders_invoice_id_fkey(invoice_number)")
      .order("created_at", { ascending: false });
    setOrders((data as any) || []);
    setLoading(false);
  };

  useEffect(() => { if (business) load(); }, [business]);

  const productMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);

  const filtered = filter === "all" ? orders : orders.filter(o => o.status === filter);
  const { paged, page, setPage, pageSize, setPageSize, pageCount, total: orderCount } = usePagination(filtered, 20);

  const itemsTotal = items.reduce((a, i) => a + i.quantity * i.unit_price, 0);
  // A discount can never exceed the subtotal or go negative; the order total nets it off.
  const discountApplied = Math.min(Math.max(0, discount), itemsTotal);
  const orderTotal = itemsTotal - discountApplied;

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
    setCustomer(""); setPhone(""); setChannel("online"); setPayment("cash"); setNotes(""); setDiscount(0); setItems([]);
  };

  const openEdit = (order: Order) => {
    setEditing(order);
    setCustomer(order.customer_name);
    setPhone(order.customer_phone || "");
    setChannel(order.channel);
    setPayment(order.payment_method);
    setNotes(order.notes || "");
    setDiscount(Number(order.discount_amount) || 0);
    setItems((order.order_items || []).map(it => ({
      product_id: it.product_id,
      product_name: productMap[it.product_id]?.name,
      quantity: it.quantity,
      unit_price: it.unit_price,
    })));
    setOpen(true);
  };

  const closeForm = () => { setOpen(false); resetForm(); setEditing(null); };

  const saveOrder = async () => {
    if (!business || !customer.trim() || items.length === 0) {
      return toast.error("Add a customer and at least one item");
    }
    const itemRows = (orderId: string) =>
      items.map(i => ({ order_id: orderId, product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price }));
    setSaving(true);

    if (editing) {
      const { error: e1 } = await supabase.from("orders").update({
        customer_name: customer.trim(),
        customer_phone: phone.trim() || null,
        channel, payment_method: payment,
        notes: notes.trim() || null,
        // discount_amount is added by 20260701120000_orders_discount.sql; cast until types regenerate.
        discount_amount: discountApplied, total_amount: orderTotal,
      } as any).eq("id", editing.id);
      if (e1) { setSaving(false); return toast.error(e1.message); }
      await supabase.from("order_items").delete().eq("order_id", editing.id);
      const { error: e2 } = await supabase.from("order_items").insert(itemRows(editing.id));
      if (e2) { setSaving(false); return toast.error(e2.message); }
      setSaving(false);
      closeForm();
      toast.success("Order updated");
      load();
      return;
    }

    const { data: order, error: e1 } = await supabase.from("orders").insert({
      business_id: business.id,
      staff_id: user?.id,
      customer_name: customer.trim(),
      customer_phone: phone.trim() || null,
      channel, payment_method: payment,
      notes: notes.trim() || null,
      // discount_amount is added by 20260701120000_orders_discount.sql; cast until types regenerate.
      discount_amount: discountApplied, total_amount: orderTotal,
      status: "pending",
    } as any).select().single();
    if (e1 || !order) { setSaving(false); return toast.error(e1?.message || "Failed"); }

    const { error: e2 } = await supabase.from("order_items").insert(itemRows(order.id));
    if (e2) { setSaving(false); return toast.error(e2.message); }

    setSaving(false);
    closeForm();
    toast.success("Order created");
    load();
  };

  const updateStatus = async (order: Order, newStatus: string) => {
    if (newStatus === order.status) return;
    // Guard: fulfilling (ship or deliver) deducts stock, so it must be available
    if ((newStatus === "shipped" || newStatus === "delivered") && !order.stock_deducted) {
      for (const it of order.order_items || []) {
        const p = productMap[it.product_id];
        if (p && Number(p.stock_quantity) < Number(it.quantity)) {
          return toast.error(`Not enough stock for ${p.name}`);
        }
      }
    }
    // Delivering books revenue: one RPC deducts stock (via the order trigger), records a sale and
    // creates a paid invoice, all atomically and idempotently.
    if (newStatus === "delivered") {
      const { data, error } = await supabase.rpc("deliver_order" as any, { _order_id: order.id });
      if (error) {
        if (error.message?.includes("NEEDS_REVIEW")) {
          return toast.error(`Not enough stock for ${error.message.split("NEEDS_REVIEW:")[1]?.trim() || "an item"}`);
        }
        return toast.error(error.message);
      }
      const res = (data as { invoice_number?: string }) || {};
      toast.success(res.invoice_number ? `Delivered — invoice ${res.invoice_number} created` : "Order delivered");
      load();
      onStockChanged();
      return;
    }

    const { error } = await supabase.from("orders").update({ status: newStatus }).eq("id", order.id);
    if (error) return toast.error(error.message);
    toast.success(newStatus === "cancelled" ? "Order cancelled" : `Order marked ${newStatus}`);
    load();
    if (["pending", "shipped", "cancelled"].includes(newStatus)) onStockChanged();
  };

  const requestStatusChange = (order: Order, newStatus: string) => {
    if (newStatus === order.status) return;
    if (newStatus === "pending" && order.stock_deducted) {
      setPending({
        title: "Move this order back to pending?",
        description: "The items will be returned to stock.",
        confirmLabel: "Move to pending",
        variant: "default",
        onConfirm: () => updateStatus(order, "pending"),
      });
      return;
    }
    if (newStatus === "shipped") {
      setPending({
        title: "Mark this order shipped?",
        description: order.stock_deducted
          ? "The order will be marked as shipped."
          : "This takes the items out of stock and marks the order shipped.",
        confirmLabel: "Mark shipped",
        variant: "default",
        onConfirm: () => updateStatus(order, "shipped"),
      });
      return;
    }
    if (newStatus === "delivered") {
      setPending({
        title: "Mark this order delivered?",
        description: order.stock_deducted
          ? "This creates a paid invoice for the order (a receipt you can share). Once delivered, the order can only be cancelled."
          : "This takes the items out of stock and creates a paid invoice (a receipt you can share). Once delivered, the order can only be cancelled.",
        confirmLabel: "Mark delivered",
        variant: "default",
        onConfirm: () => updateStatus(order, "delivered"),
      });
      return;
    }
    if (newStatus === "cancelled") {
      setPending({
        title: `Cancel order for ${order.customer_name}?`,
        description: order.stock_deducted
          ? "The items will be returned to stock and the order can't be reopened."
          : "This order will be cancelled and can't be reopened.",
        confirmLabel: "Cancel order",
        variant: "destructive",
        onConfirm: () => updateStatus(order, "cancelled"),
      });
      return;
    }
    updateStatus(order, newStatus);
  };

  const deleteOrder = (o: Order) => {
    const reverses = o.invoice_id || o.stock_deducted;
    setPending({
      title: `Delete order for ${o.customer_name}?`,
      description: o.invoice_id
        ? "This order and its sale/invoice will be permanently deleted, and the stock returned to inventory."
        : reverses
        ? "This order will be permanently deleted and its reserved stock returned to inventory."
        : "This order and all its items will be permanently deleted.",
      onConfirm: async () => {
        // delete_order reverses whatever stock the order holds (via its sale for a delivered order, or
        // directly for a shipped one) before removing it, so a deleted order no longer counts.
        const { error } = await supabase.rpc("delete_order" as any, { _order_id: o.id });
        if (error) return toast.error(error.message);
        toast.success("Order deleted");
        load();
      },
    });
  };

  // Once an order has shipped its stock is already deducted, so editing its items would desync
  // stock — lock the lines but still allow discount / customer / notes changes before delivery.
  const itemsLocked = !!editing?.stock_deducted;

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
        <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeForm())}>
          <DialogTrigger asChild>
            <Button variant="brand"><Plus className="size-4" /> New order</Button>
          </DialogTrigger>
          <DialogContent variant="wide" className="max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-display">{editing ? "Edit order" : "Create order"}</DialogTitle></DialogHeader>
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

              {itemsLocked ? (
                <p className="text-xs text-muted-foreground">
                  This order has shipped — its items are locked. You can still adjust the discount and details.
                </p>
              ) : (
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
              )}

              {items.length > 0 && (
                <div className="space-y-2 border border-border/60 rounded-lg p-3 bg-secondary/30">
                  {items.map(i => (
                    <div key={i.product_id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{i.product_name}</div>
                        <div className="text-xs text-muted-foreground">{fmt(i.unit_price)} each</div>
                      </div>
                      <Button variant="ghost" size="icon" className="size-7" aria-label="Decrease quantity" disabled={itemsLocked} onClick={() => updateItemQty(i.product_id, -1)}><Minus className="size-3" /></Button>
                      <Input type="number" min={1} value={i.quantity} disabled={itemsLocked} onChange={e => setItemQty(i.product_id, Number(e.target.value))} className="w-12 h-7 px-1 text-center text-sm font-medium" />
                      <Button variant="ghost" size="icon" className="size-7" aria-label="Increase quantity" disabled={itemsLocked} onClick={() => updateItemQty(i.product_id, 1)}><Plus className="size-3" /></Button>
                      <div className="w-20 text-right text-sm font-semibold">{fmt(i.unit_price * i.quantity)}</div>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-border/60 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="order-discount" className="text-sm text-muted-foreground whitespace-nowrap">Discount ({symbol})</Label>
                      <Input
                        id="order-discount"
                        type="number"
                        min={0}
                        max={itemsTotal}
                        step="0.01"
                        className="w-32 h-8 text-right"
                        value={discount || ""}
                        onChange={e => setDiscount(Math.min(Math.max(0, Number(e.target.value) || 0), itemsTotal))}
                        placeholder="0"
                      />
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Subtotal</span><span>{fmt(itemsTotal)}</span>
                    </div>
                    {discountApplied > 0 && (
                      <div className="flex justify-between text-sm text-destructive">
                        <span>Discount</span><span>-{fmt(discountApplied)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Total</span>
                      <span className="font-display font-bold text-brand-dark">{fmt(orderTotal)}</span>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <Label>Notes</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Delivery address, special instructions..." rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={closeForm}>Cancel</Button>
              <Button variant="brand" onClick={saveOrder} disabled={saving}>{saving ? "Saving..." : editing ? "Save changes" : "Create order"}</Button>
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
                    {o.invoice?.invoice_number && (
                      <Link to={`/invoices?q=${o.invoice.invoice_number}`} className="text-xs text-brand inline-flex items-center gap-1 hover:underline mt-0.5" title="View the paid invoice for this order">
                        <FileText className="size-3" /> {o.invoice.invoice_number}
                      </Link>
                    )}
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-border/60 flex flex-wrap items-center gap-2">
                  <div className="text-xs text-muted-foreground flex-1 min-w-[140px]">
                    {(o.order_items || []).map(it => `${it.quantity}× ${productMap[it.product_id]?.name || "item"}`).join(", ")}
                  </div>
                  <SearchableSelect
                    value={o.status}
                    onValueChange={(v) => requestStatusChange(o, v)}
                    disabled={isOrderLocked(o.status)}
                    className="h-9 w-[140px]"
                    options={orderStatusOptions(o.status).map(s => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
                  />
                  {/* Max-3 rule: status select · Edit · ⋮ (destructive lives in the menu). */}
                  <Hint label={o.status === "delivered" || o.status === "cancelled" ? "Delivered and cancelled orders can't be edited" : undefined} wrap>
                    <Button variant="ghost" size="sm" aria-label="Edit order" disabled={o.status === "delivered" || o.status === "cancelled"} onClick={() => openEdit(o)}>
                      <Pencil className="size-4" /> Edit
                    </Button>
                  </Hint>
                  {canManage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" aria-label={`More actions for ${o.customer_name}'s order`}><MoreHorizontal className="size-4" /> More</Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => deleteOrder(o)}>
                          <Trash2 className="size-4 mr-2" /> Delete order
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
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
        confirmLabel={pending?.confirmLabel}
        variant={pending?.variant}
        onConfirm={pending?.onConfirm ?? (() => {})}
      />
    </div>
  );
}

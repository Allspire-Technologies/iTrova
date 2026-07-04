import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, PackagePlus, Undo2, ArrowRightLeft, Upload, Download, MoreHorizontal } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useDateFormat } from "@/hooks/useDateFormat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ConfirmDialog from "@/components/ConfirmDialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { TablePageSkeleton } from "@/components/Skeletons";
import { cn } from "@/lib/utils";
import { parseCsv, readFileText, downloadCsv } from "@/lib/csv";
import {
  listItems, saveItem, addItemStock, deleteItem,
  listStaff, saveStaff, deleteStaff,
  listTransactions, checkout, returnBorrow,
  outstanding, isOverdue, itemStatus, friendlyStoreError,
  parseStoreItemsCsv, parseStoreStaffCsv, bulkInsertItems, bulkInsertStaff,
  ITEM_KIND_LABEL, TXN_STATUS_LABEL,
  type StoreItem, type StoreStaff, type StoreTransaction, type StoreItemKind, type TxnKind,
} from "@/lib/generalStore";

const selectCls = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";
const TABS = [{ key: "items", label: "Items" }, { key: "staff", label: "Staff" }, { key: "records", label: "Records" }] as const;
type TabKey = (typeof TABS)[number]["key"];

const emptyItemForm = { id: undefined as string | undefined, name: "", category: "", unit: "pcs", kind: "consumable" as StoreItemKind, stock_quantity: "", reorder_level: "0" };
const emptyStaffForm = { id: undefined as string | undefined, name: "", role: "", phone: "", active: true };

export default function GeneralStore() {
  const { business, role, user } = useAuth();
  void user;
  const isOwner = role === "owner";
  const { fmtDate } = useDateFormat();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [tab, setTab] = useState<TabKey>("items");
  const [items, setItems] = useState<StoreItem[] | null>(null);
  const [staff, setStaff] = useState<StoreStaff[] | null>(null);
  const [txns, setTxns] = useState<StoreTransaction[] | null>(null);

  const reloadItems = () => listItems().then(setItems).catch((e) => toast.error(e?.message ?? "Couldn't load items"));
  const reloadStaff = () => listStaff().then(setStaff).catch((e) => toast.error(e?.message ?? "Couldn't load staff"));
  const reloadTxns = () => listTransactions().then(setTxns).catch((e) => toast.error(e?.message ?? "Couldn't load records"));

  useEffect(() => { reloadItems(); reloadStaff(); reloadTxns(); }, []);

  // ---- dialogs
  const [itemForm, setItemForm] = useState<typeof emptyItemForm | null>(null);
  const [staffForm, setStaffForm] = useState<typeof emptyStaffForm | null>(null);
  const [addStock, setAddStock] = useState<{ item: StoreItem; qty: string } | null>(null);
  const [checkoutForm, setCheckoutForm] = useState<{ kind: TxnKind; item_id: string; staff_id: string; quantity: string; due_date: string; notes: string } | null>(null);
  const [returnForm, setReturnForm] = useState<{ txn: StoreTransaction; qty: string } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; description: string; onConfirm: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const itemFileRef = useRef<HTMLInputElement>(null);
  const staffFileRef = useRef<HTMLInputElement>(null);

  const staffById = useMemo(() => new Map((staff ?? []).map((s) => [s.id, s])), [staff]);

  // ---- item actions
  async function submitItem() {
    if (!business || !itemForm) return;
    if (!itemForm.name.trim()) return toast.error("Enter an item name");
    setBusy(true);
    try {
      await saveItem(business.id, { ...itemForm, stock_quantity: Number(itemForm.stock_quantity) || 0, reorder_level: Number(itemForm.reorder_level) || 0 });
      toast.success(itemForm.id ? "Item updated" : "Item added");
      setItemForm(null); reloadItems();
    } catch (e) { toast.error((e as { message?: string })?.message ?? "Couldn't save the item"); } finally { setBusy(false); }
  }
  async function submitAddStock() {
    if (!addStock) return;
    const qty = Number(addStock.qty) || 0;
    if (qty <= 0) return toast.error("Enter a quantity to add");
    setBusy(true);
    try { await addItemStock(addStock.item.id, addStock.item.stock_quantity, qty); toast.success("Stock added"); setAddStock(null); reloadItems(); }
    catch (e) { toast.error((e as { message?: string })?.message ?? "Couldn't add stock"); } finally { setBusy(false); }
  }

  // ---- staff actions
  async function submitStaff() {
    if (!business || !staffForm) return;
    if (!staffForm.name.trim()) return toast.error("Enter a name");
    setBusy(true);
    try { await saveStaff(business.id, staffForm); toast.success(staffForm.id ? "Staff updated" : "Staff added"); setStaffForm(null); reloadStaff(); }
    catch (e) { toast.error((e as { message?: string })?.message ?? "Couldn't save staff"); } finally { setBusy(false); }
  }

  // ---- checkout / return
  function openCheckout(kind: TxnKind, item_id = "") { setCheckoutForm({ kind, item_id, staff_id: "", quantity: "1", due_date: "", notes: "" }); }
  async function submitCheckout() {
    if (!business || !checkoutForm) return;
    if (!checkoutForm.item_id) return toast.error("Choose an item");
    if (!checkoutForm.staff_id) return toast.error("Choose a staff member");
    const qty = Number(checkoutForm.quantity) || 0;
    if (qty <= 0) return toast.error("Enter a quantity");
    setBusy(true);
    try {
      await checkout(business.id, { item_id: checkoutForm.item_id, staff_id: checkoutForm.staff_id, kind: checkoutForm.kind, quantity: qty, due_date: checkoutForm.kind === "borrow" ? (checkoutForm.due_date || null) : null, notes: checkoutForm.notes });
      toast.success(checkoutForm.kind === "borrow" ? "Item given out" : "Item collected");
      setCheckoutForm(null); reloadItems(); reloadTxns();
    } catch (e) { toast.error(friendlyStoreError((e as { message?: string })?.message, "Couldn't record it")); } finally { setBusy(false); }
  }
  async function submitReturn() {
    if (!returnForm) return;
    const qty = Number(returnForm.qty) || 0;
    if (qty <= 0) return toast.error("Enter a quantity");
    setBusy(true);
    try { await returnBorrow(returnForm.txn.id, qty); toast.success("Return recorded"); setReturnForm(null); reloadItems(); reloadTxns(); }
    catch (e) { toast.error(friendlyStoreError((e as { message?: string })?.message, "Couldn't record the return")); } finally { setBusy(false); }
  }

  // ---- CSV import
  async function importItems(file: File) {
    if (!business) return;
    try {
      const { inserts, skipped } = parseStoreItemsCsv(parseCsv(await readFileText(file)));
      if (inserts.length === 0) return toast.error("No valid rows — each item needs a Name.");
      await bulkInsertItems(business.id, inserts);
      toast.success(`Imported ${inserts.length} item${inserts.length === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped` : ""}`);
      reloadItems();
    } catch (e) { toast.error((e as { message?: string })?.message ?? "Import failed"); }
    finally { if (itemFileRef.current) itemFileRef.current.value = ""; }
  }
  async function importStaff(file: File) {
    if (!business) return;
    try {
      const { inserts, skipped } = parseStoreStaffCsv(parseCsv(await readFileText(file)));
      if (inserts.length === 0) return toast.error("No valid rows — each person needs a Name.");
      await bulkInsertStaff(business.id, inserts);
      toast.success(`Imported ${inserts.length} staff${skipped ? ` · ${skipped} skipped` : ""}`);
      reloadStaff();
    } catch (e) { toast.error((e as { message?: string })?.message ?? "Import failed"); }
    finally { if (staffFileRef.current) staffFileRef.current.value = ""; }
  }
  const itemsTemplate = () => downloadCsv("general-store-items.csv", "Name,Category,Unit,Kind,Stock Quantity,Reorder Level\nCordless Drill,Tools,pcs,Borrowable,3,1\nWood Screws,Fasteners,box,Consumable,500,50");
  const staffTemplate = () => downloadCsv("general-store-staff.csv", "Name,Role,Phone,Active\nAyo Bello,Machine Operator,08000000000,true");

  const loading = items === null || staff === null || txns === null;
  if (loading) return <TablePageSkeleton />;

  const checkoutItems = (items ?? []).filter((i) => checkoutForm && (checkoutForm.kind === "borrow" ? i.kind === "borrowable" : i.kind === "consumable"));

  // Shared action buttons — rendered in the desktop table cells AND the mobile cards.
  // House rule: max 3 visible actions per row; the rest live in a MoreHorizontal menu.
  const itemActions = (it: StoreItem) => (
    <>
      <Button variant="ghost" size="sm" onClick={() => openCheckout(it.kind === "borrowable" ? "borrow" : "collect", it.id)}><ArrowRightLeft className="size-4" /> {it.kind === "borrowable" ? "Lend" : "Give"}</Button>
      <Button variant="ghost" size="sm" onClick={() => setAddStock({ item: it, qty: "" })}><PackagePlus className="size-4" /> Add stock</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`More actions for ${it.name}`}><MoreHorizontal className="size-4" /> More</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setItemForm({ id: it.id, name: it.name, category: it.category ?? "", unit: it.unit ?? "pcs", kind: it.kind, stock_quantity: "", reorder_level: String(it.reorder_level) })}>
            <Pencil className="size-4 mr-2" /> Edit
          </DropdownMenuItem>
          {isOwner && (
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirm({ title: `Delete ${it.name}?`, description: "This removes the item. Its past records stay.", onConfirm: async () => { await deleteItem(it.id); reloadItems(); toast.success("Item deleted"); } })}>
              <Trash2 className="size-4 mr-2" /> Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
  const staffActions = (s: StoreStaff) => (
    <>
      <Button variant="ghost" size="sm" onClick={() => setStaffForm({ id: s.id, name: s.name, role: s.role ?? "", phone: s.phone ?? "", active: s.active })}><Pencil className="size-4" /> Edit</Button>
      {isOwner && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label={`More actions for ${s.name}`}><MoreHorizontal className="size-4" /> More</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setConfirm({ title: `Delete ${s.name}?`, description: "This removes the staff member. Their past records stay.", onConfirm: async () => { await deleteStaff(s.id); reloadStaff(); toast.success("Staff deleted"); } })}>
              <Trash2 className="size-4 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );

  return (
    <div className="space-y-6 w-full">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl lg:text-4xl font-bold text-brand-dark">General Store</h1>
          <p className="text-muted-foreground mt-1">Internal store — staff borrow tools or collect materials.</p>
        </div>
        <Button variant="hero" onClick={() => openCheckout("borrow")}><ArrowRightLeft className="size-4" /> Give out</Button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border/60">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors", tab === t.key ? "border-brand text-brand-dark" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ITEMS */}
      {tab === "items" && (
        <div className="space-y-3">
          <div className="flex justify-end flex-wrap gap-2">
            <input ref={itemFileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importItems(e.target.files[0])} />
            <Button variant="outline" onClick={itemsTemplate}><Download className="size-4" /> CSV template</Button>
            <Button variant="outline" onClick={() => itemFileRef.current?.click()}><Upload className="size-4" /> Import CSV</Button>
            <Button variant="outline" onClick={() => setItemForm({ ...emptyItemForm })}><Plus className="size-4" /> Add item</Button>
          </div>
          {/* Desktop table */}
          <div className="hidden rounded-xl border border-border/60 bg-card overflow-x-auto sm:block">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>Item</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Available</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {items.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No items yet.</TableCell></TableRow>}
                {items.map((it) => {
                  const st = itemStatus(it);
                  return (
                    <TableRow key={it.id} className="hover:bg-transparent">
                      <TableCell><span className="font-medium text-brand-dark">{it.name}</span>{it.category && <span className="text-muted-foreground"> · {it.category}</span>}</TableCell>
                      <TableCell><Badge variant="secondary">{ITEM_KIND_LABEL[it.kind]}</Badge></TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <span className={cn("font-medium", st === "out" ? "text-danger" : st === "low" ? "text-warning" : "text-brand-dark")}>{it.stock_quantity}</span>
                        <span className="text-muted-foreground"> {it.unit}</span>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">{itemActions(it)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {/* Cards (mobile) — table columns/actions would clip off-screen at phone widths (mobile audit). */}
          <div className="space-y-2 sm:hidden">
            {items.length === 0 && <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">No items yet.</p>}
            {items.map((it) => {
              const st = itemStatus(it);
              return (
                <div key={it.id} className="rounded-xl border border-border/60 bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-brand-dark">{it.name}</p>
                      {it.category && <p className="text-xs text-muted-foreground">{it.category}</p>}
                    </div>
                    <Badge variant="secondary" className="shrink-0">{ITEM_KIND_LABEL[it.kind]}</Badge>
                  </div>
                  <p className="mt-1.5 text-sm">
                    <span className={cn("font-medium", st === "out" ? "text-danger" : st === "low" ? "text-warning" : "text-brand-dark")}>{it.stock_quantity}</span>
                    <span className="text-muted-foreground"> {it.unit} available</span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border/50 pt-2">{itemActions(it)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* STAFF */}
      {tab === "staff" && (
        <div className="space-y-3">
          <div className="flex justify-end flex-wrap gap-2">
            <input ref={staffFileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importStaff(e.target.files[0])} />
            <Button variant="outline" onClick={staffTemplate}><Download className="size-4" /> CSV template</Button>
            <Button variant="outline" onClick={() => staffFileRef.current?.click()}><Upload className="size-4" /> Import CSV</Button>
            <Button variant="outline" onClick={() => setStaffForm({ ...emptyStaffForm })}><Plus className="size-4" /> Add staff</Button>
          </div>
          {/* Desktop table */}
          <div className="hidden rounded-xl border border-border/60 bg-card overflow-x-auto sm:block">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent"><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Phone</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {staff.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">No staff yet.</TableCell></TableRow>}
                {staff.map((s) => (
                  <TableRow key={s.id} className="hover:bg-transparent">
                    <TableCell><span className={cn("font-medium", s.active ? "text-brand-dark" : "text-muted-foreground line-through")}>{s.name}</span></TableCell>
                    <TableCell className="text-muted-foreground">{s.role || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{s.phone || "—"}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">{staffActions(s)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* Cards (mobile) */}
          <div className="space-y-2 sm:hidden">
            {staff.length === 0 && <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">No staff yet.</p>}
            {staff.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-card p-3">
                <div className="min-w-0">
                  <p className={cn("font-medium", s.active ? "text-brand-dark" : "text-muted-foreground line-through")}>{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{[s.role, s.phone].filter(Boolean).join(" · ") || "—"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">{staffActions(s)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* RECORDS */}
      {tab === "records" && (
        <>
        {/* Desktop table */}
        <div className="hidden rounded-xl border border-border/60 bg-card overflow-x-auto sm:block">
          <Table>
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>Item</TableHead><TableHead>Staff</TableHead><TableHead>Action</TableHead>
              <TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Outstanding</TableHead>
              <TableHead>Status</TableHead><TableHead>When</TableHead><TableHead className="text-right">Return</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {txns.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No borrow or collect records yet.</TableCell></TableRow>}
              {txns.map((t) => {
                const out = outstanding(t);
                const overdue = isOverdue(t, today);
                return (
                  <TableRow key={t.id} className="hover:bg-transparent">
                    <TableCell className="font-medium text-brand-dark">{t.item?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{t.staff?.name ?? (t.staff_id ? "—" : "Unassigned")}</TableCell>
                    <TableCell><Badge variant={t.kind === "borrow" ? "outline" : "secondary"}>{t.kind === "borrow" ? "Borrow" : "Collect"}</Badge></TableCell>
                    <TableCell className="text-right">{t.quantity}</TableCell>
                    <TableCell className="text-right">{t.kind === "borrow" ? out : "—"}</TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">{TXN_STATUS_LABEL[t.status]}</span>
                      {overdue && <Badge variant="destructive" className="ml-2">Overdue</Badge>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(t.created_at)}{t.due_date && t.kind === "borrow" ? ` · due ${fmtDate(t.due_date)}` : ""}</TableCell>
                    <TableCell className="text-right">
                      {t.kind === "borrow" && out > 0 && <Button variant="ghost" size="sm" onClick={() => setReturnForm({ txn: t, qty: String(out) })}><Undo2 className="size-4" /> Return</Button>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {/* Cards (mobile) — the 8-column ledger hid status/overdue/Return off-screen at phone widths (mobile audit). */}
        <div className="space-y-2 sm:hidden">
          {txns.length === 0 && <p className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">No borrow or collect records yet.</p>}
          {txns.map((t) => {
            const out = outstanding(t);
            const overdue = isOverdue(t, today);
            return (
              <div key={t.id} className="rounded-xl border border-border/60 bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-brand-dark">{t.item?.name ?? "—"}</p>
                  <Badge variant={t.kind === "borrow" ? "outline" : "secondary"} className="shrink-0">{t.kind === "borrow" ? "Borrow" : "Collect"}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{t.staff?.name ?? (t.staff_id ? "—" : "Unassigned")}</span>
                  <span>Qty {t.quantity}{t.kind === "borrow" ? ` · out ${out}` : ""}</span>
                  <span>{TXN_STATUS_LABEL[t.status]}</span>
                  {overdue && <Badge variant="destructive">Overdue</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{fmtDate(t.created_at)}{t.due_date && t.kind === "borrow" ? ` · due ${fmtDate(t.due_date)}` : ""}</p>
                {t.kind === "borrow" && out > 0 && (
                  <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => setReturnForm({ txn: t, qty: String(out) })}>
                    <Undo2 className="size-4" /> Return
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        </>
      )}

      {/* Item form dialog */}
      <Dialog open={!!itemForm} onOpenChange={(o) => !o && setItemForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{itemForm?.id ? "Edit item" : "Add item"}</DialogTitle></DialogHeader>
          {itemForm && (
            <div className="space-y-3">
              <div className="space-y-2"><Label>Name</Label><Input value={itemForm.name} onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })} placeholder="e.g. Cordless drill" /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Type</Label>
                  <select className={selectCls} value={itemForm.kind} onChange={(e) => setItemForm({ ...itemForm, kind: e.target.value as StoreItemKind })} aria-label="Item type">
                    <option value="borrowable">Borrowable (tool — returns)</option>
                    <option value="consumable">Consumable (material — collect)</option>
                  </select>
                </div>
                <div className="space-y-2"><Label>Unit</Label><Input value={itemForm.unit} onChange={(e) => setItemForm({ ...itemForm, unit: e.target.value })} placeholder="pcs" /></div>
                <div className="space-y-2"><Label>Category</Label><Input value={itemForm.category} onChange={(e) => setItemForm({ ...itemForm, category: e.target.value })} placeholder="Optional" /></div>
                <div className="space-y-2"><Label>Reorder level</Label><Input type="number" min={0} value={itemForm.reorder_level} onChange={(e) => setItemForm({ ...itemForm, reorder_level: e.target.value })} /></div>
                {!itemForm.id && <div className="space-y-2"><Label>Opening stock</Label><Input type="number" min={0} value={itemForm.stock_quantity} onChange={(e) => setItemForm({ ...itemForm, stock_quantity: e.target.value })} placeholder="0" /></div>}
              </div>
              {itemForm.id && <p className="text-xs text-muted-foreground">Use “Add stock” to change quantity — editing here won’t.</p>}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setItemForm(null)}>Cancel</Button><Button variant="brand" onClick={submitItem} disabled={busy}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add stock dialog */}
      <Dialog open={!!addStock} onOpenChange={(o) => !o && setAddStock(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add stock — {addStock?.item.name}</DialogTitle></DialogHeader>
          {addStock && <div className="space-y-2"><Label>Quantity to add ({addStock.item.unit})</Label><Input type="number" min={0} value={addStock.qty} onChange={(e) => setAddStock({ ...addStock, qty: e.target.value })} autoFocus /></div>}
          <DialogFooter><Button variant="outline" onClick={() => setAddStock(null)}>Cancel</Button><Button variant="brand" onClick={submitAddStock} disabled={busy}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Staff form dialog */}
      <Dialog open={!!staffForm} onOpenChange={(o) => !o && setStaffForm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{staffForm?.id ? "Edit staff" : "Add staff"}</DialogTitle></DialogHeader>
          {staffForm && (
            <div className="space-y-3">
              <div className="space-y-2"><Label>Name</Label><Input value={staffForm.name} onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })} placeholder="Full name" /></div>
              <div className="space-y-2"><Label>Role</Label><Input value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })} placeholder="e.g. Machine operator" /></div>
              <div className="space-y-2"><Label>Phone</Label><Input value={staffForm.phone} onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value })} placeholder="Optional" /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={staffForm.active} onChange={(e) => setStaffForm({ ...staffForm, active: e.target.checked })} /> Active</label>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setStaffForm(null)}>Cancel</Button><Button variant="brand" onClick={submitStaff} disabled={busy}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Checkout dialog */}
      <Dialog open={!!checkoutForm} onOpenChange={(o) => !o && setCheckoutForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Give out an item</DialogTitle></DialogHeader>
          {checkoutForm && (
            <div className="space-y-3">
              <div className="space-y-2"><Label>Action</Label>
                <select className={selectCls} value={checkoutForm.kind} onChange={(e) => setCheckoutForm({ ...checkoutForm, kind: e.target.value as TxnKind, item_id: "" })} aria-label="Action">
                  <option value="borrow">Borrow (tool — will be returned)</option>
                  <option value="collect">Collect (material — taken permanently)</option>
                </select>
              </div>
              <div className="space-y-2"><Label>Item</Label>
                <select className={selectCls} value={checkoutForm.item_id} onChange={(e) => setCheckoutForm({ ...checkoutForm, item_id: e.target.value })} aria-label="Item">
                  <option value="">Select an item…</option>
                  {checkoutItems.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.stock_quantity} {i.unit})</option>)}
                </select>
              </div>
              <div className="space-y-2"><Label>Staff</Label>
                <select className={selectCls} value={checkoutForm.staff_id} onChange={(e) => setCheckoutForm({ ...checkoutForm, staff_id: e.target.value })} aria-label="Staff">
                  <option value="">Select a staff member…</option>
                  {(staff ?? []).filter((s) => s.active || s.id === checkoutForm.staff_id).map((s) => <option key={s.id} value={s.id}>{s.name}{s.role ? ` · ${s.role}` : ""}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Quantity</Label><Input type="number" min={1} value={checkoutForm.quantity} onChange={(e) => setCheckoutForm({ ...checkoutForm, quantity: e.target.value })} aria-label="Quantity" /></div>
                {checkoutForm.kind === "borrow" && <div className="space-y-2"><Label>Due date</Label><Input type="date" value={checkoutForm.due_date} onChange={(e) => setCheckoutForm({ ...checkoutForm, due_date: e.target.value })} /></div>}
              </div>
              <div className="space-y-2"><Label>Notes</Label><Input value={checkoutForm.notes} onChange={(e) => setCheckoutForm({ ...checkoutForm, notes: e.target.value })} placeholder="Optional" /></div>
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setCheckoutForm(null)}>Cancel</Button><Button variant="brand" onClick={submitCheckout} disabled={busy}>{checkoutForm?.kind === "borrow" ? "Give out" : "Record collection"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return dialog */}
      <Dialog open={!!returnForm} onOpenChange={(o) => !o && setReturnForm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Return — {returnForm?.txn.item?.name}</DialogTitle></DialogHeader>
          {returnForm && (
            <div className="space-y-2">
              <Label>Quantity to return (outstanding {outstanding(returnForm.txn)})</Label>
              <Input type="number" min={1} max={outstanding(returnForm.txn)} value={returnForm.qty} onChange={(e) => setReturnForm({ ...returnForm, qty: e.target.value })} autoFocus />
              {returnForm.txn.staff_id && <p className="text-xs text-muted-foreground">Borrowed by {staffById.get(returnForm.txn.staff_id)?.name ?? returnForm.txn.staff?.name ?? "staff"}.</p>}
            </div>
          )}
          <DialogFooter><Button variant="outline" onClick={() => setReturnForm(null)}>Cancel</Button><Button variant="brand" onClick={submitReturn} disabled={busy}>Record return</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)} title={confirm?.title ?? ""} description={confirm?.description} confirmLabel="Delete" onConfirm={() => confirm?.onConfirm()} />
    </div>
  );
}

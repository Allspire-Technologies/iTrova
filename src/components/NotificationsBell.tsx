import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, PackageX, AlertTriangle, CalendarClock, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrency } from "@/hooks/useCurrency";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type NotifKind = "outofstock" | "lowstock" | "overdue";
type Notif = { key: string; kind: NotifKind; title: string; detail: string; to: string };

const KIND_RANK: Record<NotifKind, number> = { outofstock: 0, overdue: 1, lowstock: 2 };

const KIND_STYLE: Record<NotifKind, { icon: typeof Bell; wrap: string }> = {
  outofstock: { icon: PackageX,       wrap: "bg-danger/10 text-danger" },
  overdue:    { icon: CalendarClock,  wrap: "bg-danger/10 text-danger" },
  lowstock:   { icon: AlertTriangle,  wrap: "bg-warning/10 text-warning" },
};

export default function NotificationsBell() {
  const { business, role, user } = useAuth();
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());

  // Low stock & overdue invoices are owner/manager concerns — those pages are role-gated.
  const enabled = !!business && (role === "owner" || role === "manager");
  const storageKey = business ? `itrova:notif-read:${business.id}` : "itrova:notif-read";

  const persistSeen = useCallback((s: Set<string>) => {
    try { localStorage.setItem(storageKey, JSON.stringify([...s])); } catch { /* ignore */ }
  }, [storageKey]);

  const compute = useCallback(async (): Promise<Notif[]> => {
    if (!enabled || !user) return [];

    // Respect the user's Settings → Notification Preferences (both default on when unset).
    const { data: prof } = await supabase.from("profiles").select("notification_prefs").eq("id", user.id).maybeSingle();
    const prefs = (prof?.notification_prefs ?? {}) as Partial<{ low_stock_alerts: boolean; overdue_invoice_alerts: boolean }>;
    const wantLowStock = prefs.low_stock_alerts !== false;
    const wantOverdue = prefs.overdue_invoice_alerts !== false;

    type ProdRow = { id: string; name: string; unit: string | null; stock_quantity: number; reorder_level: number };
    type InvRow = { id: string; invoice_number: string; customer_name: string; total: number; due_date: string };

    const list: Notif[] = [];

    if (wantLowStock) {
      const { data: prods } = await supabase.from("products").select("id,name,unit,stock_quantity,reorder_level");
      for (const p of (prods as ProdRow[] | null) || []) {
        const stock = Number(p.stock_quantity);
        const reorder = Number(p.reorder_level);
        if (stock <= 0) {
          list.push({ key: `oos:${p.id}`, kind: "outofstock", title: p.name, detail: "Out of stock — restock needed", to: "/inventory" });
        } else if (stock <= reorder) {
          list.push({ key: `low:${p.id}`, kind: "lowstock", title: p.name, detail: `Low stock — ${stock}${p.unit ? ` ${p.unit}` : ""} left (reorder at ${reorder})`, to: "/inventory" });
        }
      }
    }

    if (wantOverdue) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: invs } = await supabase.from("invoices")
        .select("id,invoice_number,customer_name,total,due_date,status")
        .eq("status", "issued").not("due_date", "is", null).lt("due_date", today);
      for (const inv of (invs as InvRow[] | null) || []) {
        const days = Math.max(1, Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86_400_000));
        list.push({
          key: `ovd:${inv.id}`,
          kind: "overdue",
          title: `${inv.invoice_number} · ${inv.customer_name}`,
          detail: `${fmt(Number(inv.total))} · ${days} day${days === 1 ? "" : "s"} overdue`,
          to: "/invoices",
        });
      }
    }

    list.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.title.localeCompare(b.title));
    return list;
  }, [enabled, user, fmt]);

  // markRead=true acknowledges all current alerts (clears the badge); otherwise just
  // prunes the seen set down to alerts that still exist so resolved-then-recurring
  // issues notify again.
  const load = useCallback(async (markRead = false) => {
    const list = await compute();
    setNotifs(list);
    const currentKeys = new Set(list.map(n => n.key));
    setSeen(prev => {
      const next = markRead ? currentKeys : new Set([...prev].filter(k => currentKeys.has(k)));
      persistSeen(next);
      return next;
    });
  }, [compute, persistSeen]);

  useEffect(() => {
    if (!enabled) { setNotifs([]); return; }
    try {
      const raw = localStorage.getItem(storageKey);
      setSeen(new Set(raw ? JSON.parse(raw) : []));
    } catch { setSeen(new Set()); }
    load(false);
    const onFocus = () => load(false);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, storageKey]);

  const unread = notifs.filter(n => !seen.has(n.key)).length;

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) load(true); // opening the panel acknowledges the current alerts
  };

  const go = (to: string) => { setOpen(false); navigate(to); };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? ` (${unread} new)` : ""}`}>
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-danger-foreground text-[10px] font-bold grid place-items-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-display font-semibold text-sm">Notifications</div>
          {notifs.length > 0 && <span className="text-xs text-muted-foreground">{notifs.length} alert{notifs.length === 1 ? "" : "s"}</span>}
        </div>

        {notifs.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <CheckCircle2 className="size-8 mx-auto mb-2 text-brand/60" />
            <p className="text-sm text-muted-foreground">You're all caught up.</p>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {notifs.map(n => {
              const { icon: Icon, wrap } = KIND_STYLE[n.kind];
              const isUnread = !seen.has(n.key);
              return (
                <button
                  key={n.key}
                  onClick={() => go(n.to)}
                  className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className={`size-8 rounded-lg grid place-items-center shrink-0 ${wrap}`}>
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">{n.title}</div>
                    <div className="text-xs text-muted-foreground">{n.detail}</div>
                  </div>
                  {isUnread && <span className="mt-1.5 size-2 rounded-full bg-brand shrink-0" aria-label="Unread" />}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

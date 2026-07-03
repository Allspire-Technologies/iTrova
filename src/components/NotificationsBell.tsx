import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, PackageX, AlertTriangle, CalendarClock, FileText, CreditCard, CheckCircle2, Warehouse } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type NotifType = "low_stock" | "out_of_stock" | "overdue" | "invoice_edited" | "plan_expiring" | "plan_expired" | "store_low_stock" | "store_out_of_stock" | "store_overdue" | "expiring";
type Notif = {
  id: string;
  type: NotifType;
  title: string;
  body: string | null;
  entity_type: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

const STYLE: Record<NotifType, { icon: typeof Bell; wrap: string }> = {
  out_of_stock:       { icon: PackageX,      wrap: "bg-danger/10 text-danger" },
  overdue:            { icon: CalendarClock, wrap: "bg-danger/10 text-danger" },
  low_stock:          { icon: AlertTriangle, wrap: "bg-warning/10 text-warning" },
  expiring:           { icon: CalendarClock, wrap: "bg-warning/10 text-warning" },
  invoice_edited:     { icon: FileText,      wrap: "bg-brand-light text-brand" },
  plan_expired:       { icon: CreditCard,    wrap: "bg-danger/10 text-danger" },
  plan_expiring:      { icon: CreditCard,    wrap: "bg-warning/10 text-warning" },
  store_out_of_stock: { icon: Warehouse,     wrap: "bg-danger/10 text-danger" },
  store_overdue:      { icon: CalendarClock, wrap: "bg-danger/10 text-danger" },
  store_low_stock:    { icon: Warehouse,     wrap: "bg-warning/10 text-warning" },
};

export default function NotificationsBell() {
  const { business, user, role } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);

  const enabled = !!business && !!user;
  const canManage = role === "owner" || role === "manager";

  const load = useCallback(async (doSync: boolean) => {
    if (!enabled) { setNotifs([]); return; }
    if (doSync && canManage) await supabase.rpc("sync_notifications" as any);
    const { data } = await supabase
      .from("notifications")
      .select("id,type,title,body,entity_type,link,read_at,created_at")
      .order("created_at", { ascending: false });
    setNotifs((data as Notif[] | null) ?? []);
  }, [enabled, canManage]);

  useEffect(() => {
    if (!enabled) { setNotifs([]); return; }
    load(true);
    const onFocus = () => load(false);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled, load]);

  const unread = notifs.filter(n => !n.read_at).length;

  const onOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) load(true);
  };

  const markAllRead = async () => {
    if (!notifs.some(n => !n.read_at)) return;
    const now = new Date().toISOString();
    setNotifs(prev => prev.map(n => n.read_at ? n : { ...n, read_at: now }));
    await supabase.from("notifications").update({ read_at: now }).is("read_at", null);
  };

  const onClickNotif = async (n: Notif) => {
    setOpen(false);
    if (n.type === "invoice_edited") {
      setNotifs(prev => prev.filter(x => x.id !== n.id));
      await supabase.from("notifications").delete().eq("id", n.id);
    } else if (!n.read_at) {
      const now = new Date().toISOString();
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, read_at: now } : x));
      await supabase.from("notifications").update({ read_at: now }).eq("id", n.id);
    }
    const to = n.entity_type === "product"
      ? `/inventory?q=${encodeURIComponent(n.title)}`
      : (n.link || "/");
    navigate(to);
  };

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
          {unread > 0
            ? <button onClick={markAllRead} className="text-xs font-medium text-brand hover:underline">Mark all as read</button>
            : notifs.length > 0 && <span className="text-xs text-muted-foreground">{notifs.length} alert{notifs.length === 1 ? "" : "s"}</span>}
        </div>

        {notifs.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <CheckCircle2 className="size-8 mx-auto mb-2 text-brand/60" />
            <p className="text-sm text-muted-foreground">You're all caught up.</p>
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {notifs.map(n => {
              const { icon: Icon, wrap } = STYLE[n.type] ?? STYLE.invoice_edited;
              return (
                <button
                  key={n.id}
                  onClick={() => onClickNotif(n)}
                  className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                >
                  <div className={`size-8 rounded-lg grid place-items-center shrink-0 ${wrap}`}>
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground truncate">{n.title}</div>
                    {n.body && <div className="text-xs text-muted-foreground">{n.body}</div>}
                  </div>
                  {!n.read_at && <span className="mt-1.5 size-2 rounded-full bg-brand shrink-0" aria-label="Unread" />}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

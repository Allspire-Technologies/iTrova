import { NavLink, Outlet, useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { visiblePinned, visibleSections, allVisibleModuleItems, sectionKeyForPath, SETTINGS_ITEM, type NavItem } from "@/lib/nav";
import { LogOut, Store, Menu, ChevronLeft, ChevronRight, ChevronDown, AlertTriangle, Clock, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { Suspense, useEffect, useState } from "react";
import { AppShellSkeleton, TablePageSkeleton } from "@/components/Skeletons";
import ErrorBoundary from "@/components/ErrorBoundary";
import ConfirmDialog from "@/components/ConfirmDialog";
import NotificationsBell from "@/components/NotificationsBell";
import HeaderClock from "@/components/HeaderClock";
import ThemeToggle from "@/components/ThemeToggle";
import GlobalSearch from "@/components/GlobalSearch";
import WhatsNew from "@/components/WhatsNew";
import IdleTimeout from "@/components/IdleTimeout";
import { OfflineBanner } from "@/components/OfflineBanner";
import { useOnline } from "@/contexts/OnlineContext";
import { usePrewarm } from "@/contexts/PrewarmContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { countPending, countPendingInvoices, countPendingPayments } from "@/lib/offlineStore";
import { drainQueue, drainInvoicing } from "@/lib/offlineSync";
import { toast } from "sonner";

import type { AppRole } from "@/contexts/AuthContext";

// Modules usable with no internet (POS + the read-only cached views). Everything else is dimmed
// and non-navigable while offline.
const OFFLINE_OK = new Set(["/", "/pos", "/inventory", "/invoices"]);

/** A single sidebar link (used for pinned items, section items, the icon rail and bottom Settings). */
function NavItemLink({ item, collapsed = false, online = true, onNavigate }: { item: NavItem; collapsed?: boolean; online?: boolean; onNavigate?: () => void }) {
  const offlineBlocked = !online && !OFFLINE_OK.has(item.to);
  const disabled = item.soon || offlineBlocked;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : offlineBlocked ? "Unavailable offline" : undefined}
      onClick={(e) => { if (disabled) { e.preventDefault(); return; } onNavigate?.(); }}
      className={({ isActive }) =>
        `group flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
          collapsed ? "justify-center" : ""
        } ${
          disabled
            ? "text-sidebar-foreground/40 cursor-not-allowed"
            : isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        }`
      }
    >
      <item.icon className="size-5 shrink-0" />
      {!collapsed && <span className="flex-1">{item.label}</span>}
      {!collapsed && item.soon && <span className="text-[10px] uppercase tracking-wider opacity-60">Soon</span>}
      {!collapsed && offlineBlocked && <WifiOff className="size-3.5 opacity-60" />}
    </NavLink>
  );
}

function NavList({ onNavigate, can, hasModule, collapsed = false, online = true, openSections, onToggleSection, activeSectionKey }: {
  onNavigate?: () => void;
  can: (module: string, action: string) => boolean;
  hasModule: (key: string) => boolean;
  collapsed?: boolean;
  online?: boolean;
  openSections: Record<string, boolean>;
  onToggleSection: (key: string) => void;
  activeSectionKey: string | null;
}) {
  const grants = { hasModule, can };

  // Collapsed icon rail: grouping only applies when expanded, so render every module icon flat.
  if (collapsed) {
    return (
      <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
        {allVisibleModuleItems(grants).map((item) => (
          <NavItemLink key={item.to} item={item} collapsed online={online} onNavigate={onNavigate} />
        ))}
      </nav>
    );
  }

  const pinned = visiblePinned(grants);
  const sections = visibleSections(grants);
  return (
    <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
      {pinned.map((item) => <NavItemLink key={item.to} item={item} online={online} onNavigate={onNavigate} />)}
      {sections.map((s) => {
        // Default open; the section owning the active route is always open so it can't be hidden.
        const open = (openSections[s.key] ?? true) || s.key === activeSectionKey;
        return (
          <div key={s.key} className="pt-2">
            <button
              type="button"
              onClick={() => onToggleSection(s.key)}
              aria-expanded={open}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-foreground/80 transition-colors"
            >
              <span>{s.label}</span>
              <ChevronDown className={`size-3.5 shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
            </button>
            {open && (
              <div className="space-y-1 mt-0.5">
                {s.items.map((item) => <NavItemLink key={item.to} item={item} online={online} onNavigate={onNavigate} />)}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function AppShell() {
  const { user, profile, business, role, subscription, hasModule, can, signOut, loading } = useAuth();
  const { online } = useOnline();
  const prewarm = usePrewarm();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [syncGateOpen, setSyncGateOpen] = useState(false);
  const [gatePending, setGatePending] = useState(0);
  const [gateBusy, setGateBusy] = useState(false);
  const [prewarmGateOpen, setPrewarmGateOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "true");
  // Per-section open/closed state (independent; default open), remembered across sessions.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem("sidebar-sections") || "{}"); } catch { return {}; }
  });
  const toggleSection = (key: string) => setOpenSections(prev => {
    const next = { ...prev, [key]: !(prev[key] ?? true) };
    localStorage.setItem("sidebar-sections", JSON.stringify(next));
    return next;
  });
  const activeSectionKey = sectionKeyForPath(location.pathname);

  const confirmSignOut = () => { signOut(); navigate("/auth"); };

  // Count offline work still queued on this device (POS sales + offline invoices/deposits). Throws
  // if IndexedDB is unavailable/corrupt — callers decide what to do (see requestSignOut, which logs,
  // warns, and still fails OPEN so sign-out is never stuck).
  const countUnsynced = async (businessId: string): Promise<number> =>
    (await countPending(businessId)) + (await countPendingInvoices(businessId)) + (await countPendingPayments(businessId));

  const requestSignOut = async () => {
    setMobileOpen(false);
    // Block sign-out while the offline caches are still being prepared, so they aren't left partial.
    // (On error the pre-warm finishes as 'error', which unblocks — we don't trap the user.)
    if (prewarm.status === "running") { setPrewarmGateOpen(true); return; }
    if (business) {
      try {
        const n = await countUnsynced(business.id);
        if (n > 0) { setGatePending(n); setSyncGateOpen(true); return; }
      } catch (e) {
        // Fail OPEN (never trap the user), but don't fail silently: log it and warn, since a broken
        // offline store could mean queued sales we couldn't see are about to be left behind.
        console.error("Couldn't check for unsynced offline work before sign-out:", e);
        toast.warning("Couldn't verify your offline sales have synced. Open Point of Sale to check before signing out on another device.");
      }
    }
    setSignOutOpen(true);
  };

  const syncFromGate = async () => {
    if (!business) return;
    setGateBusy(true);
    try {
      await drainQueue(business.id);
      await drainInvoicing(business.id);
      const remaining = await countUnsynced(business.id);
      setGatePending(remaining);
      if (remaining === 0) { setSyncGateOpen(false); setSignOutOpen(true); }
      else toast.warning("Some items still need attention — open Point of Sale or Invoices to review them.");
    } catch {
      toast.error("Sync failed — please try again.");
    } finally {
      setGateBusy(false);
    }
  };

  const toggleCollapsed = () => setCollapsed(prev => {
    const next = !prev;
    localStorage.setItem("sidebar-collapsed", String(next));
    return next;
  });

  useEffect(() => {
    if (!loading && !user) navigate("/auth", { replace: true });
  }, [loading, user, navigate]);

  // Once the pre-warm finishes while the "preparing offline data" gate is open, resume the
  // sign-out the user asked for (re-checks unsynced work, then shows the confirm).
  useEffect(() => {
    if (prewarmGateOpen && prewarm.status !== "running") {
      setPrewarmGateOpen(false);
      void requestSignOut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prewarmGateOpen, prewarm.status]);

  if (loading || !user) return <AppShellSkeleton />;

  const initials = (profile?.owner_name || user.email || "U").slice(0, 2).toUpperCase();

  // Owner-facing plan warning shown by the business name — expired or within 7 days of renewal.
  const planAlert =
    role === "owner" && subscription && subscription.tier !== "free" &&
    (subscription.expired || (subscription.daysRemaining != null && subscription.daysRemaining <= 7))
      ? subscription.expired
        ? { text: "Plan expired", danger: true }
        : { text: `Expires in ${subscription.daysRemaining}d`, danger: false }
      : null;

  const MobileBrand = (
    <div className="p-6 flex items-center gap-2 font-display text-xl font-bold">
      <div className="size-9 rounded-xl bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center shrink-0">
        <Store className="size-4" />
      </div>
      iTrova
    </div>
  );

  const MobileSignOut = (
    <div className="p-4 border-t border-sidebar-border space-y-1">
      <NavItemLink item={SETTINGS_ITEM} online={online} onNavigate={() => setMobileOpen(false)} />
      <button onClick={requestSignOut} className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 transition-colors">
        <LogOut className="size-4" /> Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-var(--titlebar-h))] flex bg-gradient-soft">
      <WhatsNew />
      {/* Desktop Sidebar */}
      <aside className={`hidden lg:flex flex-col bg-sidebar text-sidebar-foreground sticky top-[var(--titlebar-h)] h-[calc(100vh-var(--titlebar-h))] transition-all duration-200 ${collapsed ? "w-16" : "w-64"}`}>
        {/* Brand + collapse toggle */}
        <div className={`flex items-center border-b border-sidebar-border shrink-0 ${collapsed ? "justify-center p-3" : "justify-between pl-6 pr-3 py-4"}`}>
          {collapsed ? (
            <button
              onClick={toggleCollapsed}
              title="Expand sidebar"
              className="size-9 rounded-xl bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center hover:opacity-80 transition-opacity"
            >
              <Store className="size-4" />
            </button>
          ) : (
            <>
              <div className="flex items-center gap-2 font-display text-xl font-bold">
                <div className="size-9 rounded-xl bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center shrink-0">
                  <Store className="size-4" />
                </div>
                iTrova
              </div>
              <button
                onClick={toggleCollapsed}
                title="Collapse sidebar"
                className="p-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
              >
                <ChevronLeft className="size-4" />
              </button>
            </>
          )}
        </div>

        <NavList can={can} hasModule={hasModule} collapsed={collapsed} online={online} openSections={openSections} onToggleSection={toggleSection} activeSectionKey={activeSectionKey} />

        {/* Settings + Sign out, pinned at the bottom */}
        <div className={`p-3 border-t border-sidebar-border shrink-0 space-y-1`}>
          <NavItemLink item={SETTINGS_ITEM} collapsed={collapsed} online={online} />
          <button
            onClick={requestSignOut}
            title={collapsed ? "Sign out" : undefined}
            className={`flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 transition-colors ${collapsed ? "justify-center" : ""}`}
          >
            <LogOut className="size-4 shrink-0" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>

        {/* Expand button when collapsed */}
        {collapsed && (
          <div className="pb-3 flex justify-center shrink-0">
            <button
              onClick={toggleCollapsed}
              title="Expand sidebar"
              className="p-1.5 rounded-md text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-[var(--titlebar-h)] z-10 bg-background/80 backdrop-blur border-b border-border">
          <div className="flex items-center gap-3 px-4 lg:px-8 h-16">
            {/* Mobile menu trigger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden -ml-2" aria-label="Open menu">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72 bg-sidebar text-sidebar-foreground border-sidebar-border flex flex-col">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                {MobileBrand}
                <NavList can={can} hasModule={hasModule} onNavigate={() => setMobileOpen(false)} online={online} openSections={openSections} onToggleSection={toggleSection} activeSectionKey={activeSectionKey} />
                {MobileSignOut}
              </SheetContent>
            </Sheet>

            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Business</div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-display font-semibold text-brand-dark truncate">
                  {business?.name || "—"}
                </span>
                {planAlert && (
                  <Link
                    to="/settings"
                    title={planAlert.danger ? "Your plan has expired — renew to restore features" : "Your plan is about to expire — renew to avoid losing features"}
                    className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-opacity hover:opacity-80 ${planAlert.danger ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"}`}
                  >
                    {planAlert.danger ? <AlertTriangle className="size-3" /> : <Clock className="size-3" />}
                    {planAlert.text}
                  </Link>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden md:block text-sm text-muted-foreground">
                {new Date().toLocaleDateString("en-NG", { timeZone: business?.timezone ?? "Africa/Lagos", weekday: "long", day: "numeric", month: "long" })}
              </div>
              <HeaderClock />
              <GlobalSearch />
              <ThemeToggle />
              <NotificationsBell />
              <div className="flex items-center gap-2">
                <Avatar className="size-9 bg-brand-light text-brand-dark">
                  <AvatarFallback className="bg-brand-light text-brand-dark font-semibold">{initials}</AvatarFallback>
                </Avatar>
                {profile?.owner_name && (
                  <span className="hidden lg:block text-sm font-medium text-brand-dark max-w-[120px] truncate">
                    {profile.owner_name}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>
        {/* Offline pre-warm progress — slim determinate bar, non-blocking */}
        {prewarm.status === "running" && (
          <div className="border-b border-border bg-card" role="progressbar" aria-label="Preparing offline data" aria-valuenow={prewarm.done} aria-valuemax={prewarm.total}>
            <div className="h-1 bg-brand transition-all duration-300" style={{ width: `${prewarm.total ? (prewarm.done / prewarm.total) * 100 : 0}%` }} />
            <div className="px-4 lg:px-8 py-1 text-[11px] text-muted-foreground">
              Preparing offline data… {prewarm.done}/{prewarm.total}
            </div>
          </div>
        )}
        <OfflineBanner />
        <main className="flex-1 p-4 lg:p-8 animate-fade-in">
          <div key={location.key} className="w-full">
            {/* A page crash shows the fallback but keeps the nav/header usable; lazy route chunks
                suspend into the skeleton while they load. Keyed by location so navigating away
                clears a crashed page. */}
            <ErrorBoundary variant="inline">
              <Suspense fallback={<TablePageSkeleton />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>

      <ConfirmDialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title="Sign out?"
        description="You'll be returned to the login screen and will need to sign in again to continue."
        confirmLabel="Sign out"
        onConfirm={confirmSignOut}
      />

      {/* Sign-out gate: unsynced offline sales must be synced first */}
      <Dialog open={syncGateOpen} onOpenChange={(o) => !gateBusy && setSyncGateOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Sync before signing out</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            You have <span className="font-semibold text-foreground">{gatePending}</span> sale{gatePending === 1 ? "" : "s"} saved on this device that haven{"’"}t synced yet.{" "}
            {online ? "Sync them now so they aren’t left behind." : "Connect to the internet, then sync, before signing out."}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSyncGateOpen(false)} disabled={gateBusy}>Stay signed in</Button>
            <Button variant="brand" onClick={syncFromGate} disabled={!online || gateBusy}>
              {gateBusy ? "Syncing…" : "Sync now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pre-warm gate: don't sign out mid-caching, or the offline data would be incomplete.
          Auto-continues the sign-out once it finishes (see the effect above). */}
      <Dialog open={prewarmGateOpen} onOpenChange={setPrewarmGateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Finishing offline setup…</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            We{"’"}re preparing your data for offline use ({prewarm.done}/{prewarm.total}). Sign-out will continue automatically once it{"’"}s done.
          </p>
          <div className="h-1 w-full bg-muted rounded overflow-hidden">
            <div className="h-full bg-brand transition-all duration-300" style={{ width: `${prewarm.total ? (prewarm.done / prewarm.total) * 100 : 0}%` }} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPrewarmGateOpen(false)}>Stay signed in</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <IdleTimeout />
    </div>
  );
}

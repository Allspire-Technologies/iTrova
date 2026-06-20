import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LayoutDashboard, Package, ShoppingCart, Truck, FileText, ClipboardList, Users, BarChart3, Sparkles, Settings, LogOut, Store, Menu, Boxes, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useEffect, useState } from "react";
import { AppShellSkeleton } from "@/components/Skeletons";
import ConfirmDialog from "@/components/ConfirmDialog";
import NotificationsBell from "@/components/NotificationsBell";

import type { AppRole } from "@/contexts/AuthContext";

type NavItem = { to: string; label: string; icon: any; end?: boolean; soon?: boolean; allow?: AppRole[] };

const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/inventory", label: "Inventory", icon: Package, allow: ["owner", "manager"] },
  { to: "/pos", label: "Point of Sale", icon: ShoppingCart },
  { to: "/suppliers", label: "Suppliers", icon: Truck, allow: ["owner", "manager"] },
  { to: "/raw-materials", label: "Raw Materials", icon: Boxes, allow: ["owner", "manager"] },
  { to: "/invoices", label: "Invoices", icon: FileText, allow: ["owner", "manager"] },
  { to: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList, allow: ["owner", "manager"] },
  { to: "/team", label: "Team", icon: Users, allow: ["owner"] },
  { to: "/reports", label: "Reports", icon: BarChart3, allow: ["owner", "manager"] },
  { to: "/insights", label: "AI Insights", icon: Sparkles, soon: true },
  { to: "/settings", label: "Settings", icon: Settings },
];

function NavList({ onNavigate, role, collapsed }: { onNavigate?: () => void; role: AppRole | null; collapsed?: boolean }) {
  const visible = nav.filter(item => !item.allow || (role && item.allow.includes(role)));
  return (
    <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
      {visible.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          title={collapsed ? item.label : undefined}
          onClick={(e) => { if (item.soon) { e.preventDefault(); return; } onNavigate?.(); }}
          className={({ isActive }) =>
            `group flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${
              collapsed ? "justify-center" : ""
            } ${
              item.soon
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
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppShell() {
  const { user, profile, business, role, signOut, loading } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebar-collapsed") === "true");

  const confirmSignOut = () => { signOut(); navigate("/auth"); };

  const toggleCollapsed = () => setCollapsed(prev => {
    const next = !prev;
    localStorage.setItem("sidebar-collapsed", String(next));
    return next;
  });

  useEffect(() => {
    if (!loading && !user) navigate("/auth", { replace: true });
  }, [loading, user, navigate]);

  if (loading || !user) return <AppShellSkeleton />;

  const initials = (profile?.owner_name || user.email || "U").slice(0, 2).toUpperCase();

  const MobileBrand = (
    <div className="p-6 flex items-center gap-2 font-display text-xl font-bold">
      <div className="size-9 rounded-xl bg-sidebar-primary text-sidebar-primary-foreground grid place-items-center shrink-0">
        <Store className="size-4" />
      </div>
      iTrova
    </div>
  );

  const MobileSignOut = (
    <div className="p-4 border-t border-sidebar-border">
      <button onClick={() => { setMobileOpen(false); setSignOutOpen(true); }} className="flex items-center gap-3 px-3 py-2 w-full rounded-lg text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 transition-colors">
        <LogOut className="size-4" /> Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-gradient-soft">
      {/* Desktop Sidebar */}
      <aside className={`hidden lg:flex flex-col bg-sidebar text-sidebar-foreground sticky top-0 h-screen transition-all duration-200 ${collapsed ? "w-16" : "w-64"}`}>
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

        <NavList role={role} collapsed={collapsed} />

        {/* Sign out */}
        <div className={`p-3 border-t border-sidebar-border shrink-0`}>
          <button
            onClick={() => setSignOutOpen(true)}
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
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur border-b border-border">
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
                <NavList role={role} onNavigate={() => setMobileOpen(false)} />
                {MobileSignOut}
              </SheetContent>
            </Sheet>

            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Business</div>
              <div className="font-display font-semibold text-brand-dark truncate">
                {business?.name || "—"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden md:block text-sm text-muted-foreground">
                {new Date().toLocaleDateString("en-NG", { timeZone: business?.timezone ?? "Africa/Lagos", weekday: "long", day: "numeric", month: "long" })}
              </div>
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
        <main className="flex-1 p-4 lg:p-8 animate-fade-in">
          <div className="w-full">
            <Outlet />
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
    </div>
  );
}

import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { OnlineProvider } from "@/contexts/OnlineContext";
import { PrewarmProvider } from "@/contexts/PrewarmContext";
import AppShell from "@/components/AppShell";
import Auth from "./pages/Auth";
import PwaTitlebar from "@/components/PwaTitlebar";
import { RoleGate } from "@/components/RoleGate";
import { ModuleGate } from "@/components/ModuleGate";
import { OfflineGate } from "@/components/OfflineGate";

// Every page except Auth is code-split so the entry bundle stays small (Experience Roadmap ·
// Phase 1). Auth stays eager: it's the first paint for logged-out users. The service worker
// precaches every chunk (scripts/stamp-sw.mjs lists all built JS), so lazy routes still load
// offline. Pages inside AppShell suspend into the Outlet fallback there, keeping the nav visible.
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"));
const InviteAuth = lazy(() => import("./pages/InviteAuth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Inventory = lazy(() => import("./pages/Inventory"));
const POS = lazy(() => import("./pages/POS"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const RawMaterials = lazy(() => import("./pages/RawMaterials"));
const Invoices = lazy(() => import("./pages/Invoices"));
const PurchaseOrders = lazy(() => import("./pages/PurchaseOrders"));
const Reports = lazy(() => import("./pages/Reports"));
const Team = lazy(() => import("./pages/Team"));
const Settings = lazy(() => import("./pages/Settings"));
const LegalDoc = lazy(() => import("./pages/LegalDoc"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Fallback for the standalone (outside-the-shell) lazy pages while their chunk loads.
const PageLoader = () => (
  <div className="min-h-screen grid place-items-center bg-gradient-soft">
    <div className="size-8 rounded-full border-2 border-brand border-t-transparent animate-spin" aria-label="Loading" />
  </div>
);

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <AuthProvider>
        <OnlineProvider>
        <PrewarmProvider>
        {/* Installed-PWA title bar (renders only under Window Controls Overlay). The wrapper below
            reserves its height so no route renders under it; --titlebar-h is 0 otherwise. */}
        <PwaTitlebar />
        <div style={{ paddingTop: "var(--titlebar-h)" }}>
        <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/invite-auth" element={<InviteAuth />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pos" element={<POS />} />
            <Route path="/inventory" element={<RoleGate allow={["owner","manager"]}><ModuleGate module="inventory"><Inventory /></ModuleGate></RoleGate>} />
            <Route path="/suppliers" element={<OfflineGate><RoleGate allow={["owner","manager"]}><ModuleGate module="suppliers"><Suppliers /></ModuleGate></RoleGate></OfflineGate>} />
            <Route path="/raw-materials" element={<OfflineGate><RoleGate allow={["owner","manager"]}><ModuleGate module="raw_materials"><RawMaterials /></ModuleGate></RoleGate></OfflineGate>} />
            <Route path="/invoices" element={<ModuleGate module="invoices"><Invoices /></ModuleGate>} />
            <Route path="/purchase-orders" element={<OfflineGate><RoleGate allow={["owner","manager"]}><ModuleGate module="purchase_orders"><PurchaseOrders /></ModuleGate></RoleGate></OfflineGate>} />
            <Route path="/reports" element={<OfflineGate><RoleGate allow={["owner","manager"]}><ModuleGate module="reports"><Reports /></ModuleGate></RoleGate></OfflineGate>} />
            <Route path="/team" element={<OfflineGate><RoleGate allow={["owner"]}><ModuleGate module="team"><Team /></ModuleGate></RoleGate></OfflineGate>} />
            <Route path="/settings" element={<OfflineGate><Settings /></OfflineGate>} />
            <Route path="/legal/:slug" element={<LegalDoc />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </div>
        </PrewarmProvider>
        </OnlineProvider>
      </AuthProvider>
    </BrowserRouter>
  </TooltipProvider>
);

export default App;

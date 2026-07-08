import { Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { lazyWithRetry as lazy } from "@/lib/lazyWithRetry";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { OnlineProvider } from "@/contexts/OnlineContext";
import { PrewarmProvider } from "@/contexts/PrewarmContext";
import AppShell from "@/components/AppShell";
import Auth from "./pages/Auth";
import ErrorBoundary from "@/components/ErrorBoundary";
import PwaTitlebar from "@/components/PwaTitlebar";
import { PermissionGate } from "@/components/PermissionGate";
import { ModuleGate } from "@/components/ModuleGate";
import { OfflineGate } from "@/components/OfflineGate";

// Every page except Auth is code-split so the entry bundle stays small (Experience Roadmap ·
// Phase 1). Auth stays eager: it's the first paint for logged-out users. The service worker
// precaches the offline routes' chunks, so they still load offline. Pages inside AppShell suspend
// into the Outlet fallback there, keeping the nav visible. lazyWithRetry retries a chunk import a
// couple of times before failing, to ride out flaky connections and post-deploy hash changes.
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const AcceptInvite = lazy(() => import("./pages/AcceptInvite"));
const InviteAuth = lazy(() => import("./pages/InviteAuth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Inventory = lazy(() => import("./pages/Inventory"));
const GeneralStore = lazy(() => import("./pages/GeneralStore"));
const Production = lazy(() => import("./pages/Production"));
const Expenditure = lazy(() => import("./pages/Expenditure"));
const ExportInvoiceList = lazy(() => import("./pages/ExportInvoiceList"));
const ExportInvoiceView = lazy(() => import("./pages/ExportInvoiceView"));
const ExportInvoice = lazy(() => import("./pages/ExportInvoice"));
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
  <ErrorBoundary>
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
            <Route path="/pos" element={<PermissionGate module="pos"><POS /></PermissionGate>} />
            <Route path="/inventory" element={<PermissionGate module="inventory"><ModuleGate module="inventory"><Inventory /></ModuleGate></PermissionGate>} />
            <Route path="/general-store" element={<OfflineGate><PermissionGate module="general_store"><ModuleGate module="general_store"><GeneralStore /></ModuleGate></PermissionGate></OfflineGate>} />
            <Route path="/export-invoice" element={<OfflineGate><PermissionGate module="export_invoices"><ModuleGate module="export_invoices"><ExportInvoiceList /></ModuleGate></PermissionGate></OfflineGate>} />
            <Route path="/export-invoice/new" element={<OfflineGate><PermissionGate module="export_invoices" action="create"><ModuleGate module="export_invoices"><ExportInvoice /></ModuleGate></PermissionGate></OfflineGate>} />
            <Route path="/export-invoice/:id" element={<OfflineGate><PermissionGate module="export_invoices"><ModuleGate module="export_invoices"><ExportInvoiceView /></ModuleGate></PermissionGate></OfflineGate>} />
            <Route path="/export-invoice/:id/edit" element={<OfflineGate><PermissionGate module="export_invoices" action="edit"><ModuleGate module="export_invoices"><ExportInvoice /></ModuleGate></PermissionGate></OfflineGate>} />
            <Route path="/suppliers" element={<OfflineGate><PermissionGate module="suppliers"><ModuleGate module="suppliers"><Suppliers /></ModuleGate></PermissionGate></OfflineGate>} />
            <Route path="/raw-materials" element={<OfflineGate><PermissionGate module="raw_materials"><ModuleGate module="raw_materials"><RawMaterials /></ModuleGate></PermissionGate></OfflineGate>} />
            <Route path="/production" element={<OfflineGate><PermissionGate module="production"><ModuleGate module="production"><Production /></ModuleGate></PermissionGate></OfflineGate>} />
            <Route path="/expenditure" element={<OfflineGate><PermissionGate module="expenditure"><ModuleGate module="expenditure"><Expenditure /></ModuleGate></PermissionGate></OfflineGate>} />
            <Route path="/invoices" element={<PermissionGate module="invoices"><ModuleGate module="invoices"><Invoices /></ModuleGate></PermissionGate>} />
            <Route path="/purchase-orders" element={<OfflineGate><PermissionGate module="purchase_orders"><ModuleGate module="purchase_orders"><PurchaseOrders /></ModuleGate></PermissionGate></OfflineGate>} />
            <Route path="/reports" element={<OfflineGate><PermissionGate module="reports"><ModuleGate module="reports"><Reports /></ModuleGate></PermissionGate></OfflineGate>} />
            <Route path="/team" element={<OfflineGate><PermissionGate module="team"><ModuleGate module="team"><Team /></ModuleGate></PermissionGate></OfflineGate>} />
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
  </ErrorBoundary>
);

export default App;

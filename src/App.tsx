import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { OnlineProvider } from "@/contexts/OnlineContext";
import AppShell from "@/components/AppShell";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import AcceptInvite from "./pages/AcceptInvite";
import InviteAuth from "./pages/InviteAuth";
import Dashboard from "./pages/Dashboard";
import Inventory from "./pages/Inventory";
import POS from "./pages/POS";
import Suppliers from "./pages/Suppliers";
import RawMaterials from "./pages/RawMaterials";
import Invoices from "./pages/Invoices";
import PurchaseOrders from "./pages/PurchaseOrders";
import Reports from "./pages/Reports";
import Team from "./pages/Team";
import Settings from "./pages/Settings";
import LegalDoc from "./pages/LegalDoc";
import NotFound from "./pages/NotFound.tsx";
import { RoleGate } from "@/components/RoleGate";
import { ModuleGate } from "@/components/ModuleGate";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <OnlineProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/invite-auth" element={<InviteAuth />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/pos" element={<POS />} />
              <Route path="/inventory" element={<RoleGate allow={["owner","manager"]}><ModuleGate module="inventory"><Inventory /></ModuleGate></RoleGate>} />
              <Route path="/suppliers" element={<RoleGate allow={["owner","manager"]}><ModuleGate module="suppliers"><Suppliers /></ModuleGate></RoleGate>} />
              <Route path="/raw-materials" element={<RoleGate allow={["owner","manager"]}><ModuleGate module="raw_materials"><RawMaterials /></ModuleGate></RoleGate>} />
              <Route path="/invoices" element={<ModuleGate module="invoices"><Invoices /></ModuleGate>} />
              <Route path="/purchase-orders" element={<RoleGate allow={["owner","manager"]}><ModuleGate module="purchase_orders"><PurchaseOrders /></ModuleGate></RoleGate>} />
              <Route path="/reports" element={<RoleGate allow={["owner","manager"]}><ModuleGate module="reports"><Reports /></ModuleGate></RoleGate>} />
              <Route path="/team" element={<RoleGate allow={["owner"]}><ModuleGate module="team"><Team /></ModuleGate></RoleGate>} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/legal/:slug" element={<LegalDoc />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
          </OnlineProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

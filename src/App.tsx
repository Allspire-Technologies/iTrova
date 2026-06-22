import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
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
import NotFound from "./pages/NotFound.tsx";
import { RoleGate } from "@/components/RoleGate";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            <Route path="/invite-auth" element={<InviteAuth />} />
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/pos" element={<POS />} />
              <Route path="/inventory" element={<RoleGate allow={["owner","manager"]}><Inventory /></RoleGate>} />
              <Route path="/suppliers" element={<RoleGate allow={["owner","manager"]}><Suppliers /></RoleGate>} />
              <Route path="/raw-materials" element={<RoleGate allow={["owner","manager"]}><RawMaterials /></RoleGate>} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/purchase-orders" element={<RoleGate allow={["owner","manager"]}><PurchaseOrders /></RoleGate>} />
              <Route path="/reports" element={<RoleGate allow={["owner","manager"]}><Reports /></RoleGate>} />
              <Route path="/team" element={<RoleGate allow={["owner"]}><Team /></RoleGate>} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

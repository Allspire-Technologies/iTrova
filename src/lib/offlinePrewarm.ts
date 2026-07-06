import { supabase } from "@/integrations/supabase/client";
import { cacheProducts, cacheDashboard, cacheInvoices } from "@/lib/offlineStore";
import { fetchDashboardSnapshot } from "@/lib/dashboardSnapshot";
import type { CachedInvoice } from "@/lib/offlineTypes";

// Pre-warms the offline caches for every offline-capable module so they work without visiting each
// one online first. Each task reuses the same writers the pages use, so cached data is identical.

export interface PrewarmProgress { done: number; total: number; label: string }
export interface PrewarmResult { completed: number; total: number; errors: { key: string; message: string }[] }

type Task = { key: string; label: string; run: (businessId: string) => Promise<void> };

async function warmProducts(businessId: string): Promise<void> {
  const { data, error } = await supabase
    .from("products")
    .select("id,name,sku,selling_price,stock_quantity,reorder_level,category");
  if (error) throw new Error(error.message);
  await cacheProducts(businessId, (data ?? []).map((r) => ({
    id: r.id, business_id: businessId, name: r.name, sku: r.sku,
    selling_price: r.selling_price, stock_quantity: r.stock_quantity, reorder_level: r.reorder_level, category: r.category,
  })));
}

async function warmDashboard(businessId: string): Promise<void> {
  await cacheDashboard(businessId, await fetchDashboardSnapshot());
}

async function warmInvoices(businessId: string): Promise<void> {
  // Same eligibility as the Invoices page — manual invoices that can still take a deposit — but
  // filtered server-side: this used to download the business's entire invoice history to keep
  // only the eligible handful (audit F5/F6).
  const { data, error } = await supabase.from("invoices")
    .select("id,invoice_number,customer_name,total,amount_paid,status")
    .is("sale_id", null)
    .in("status", ["issued", "partial"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const eligible: CachedInvoice[] = (data ?? []).map((i) => ({
    id: i.id, business_id: businessId, invoice_number: i.invoice_number, customer_name: i.customer_name,
    total: Number(i.total), amount_paid: Number(i.amount_paid), status: i.status, cachedAt: Date.now(),
  }));
  await cacheInvoices(businessId, eligible);
}

export const PREWARM_TASKS: Task[] = [
  { key: "products", label: "Products", run: warmProducts },
  { key: "dashboard", label: "Dashboard", run: warmDashboard },
  { key: "invoices", label: "Invoices", run: warmInvoices },
];

let running = false;

/**
 * Run every pre-warm task in order, reporting progress after each. A task that fails is recorded
 * (in `errors`) but does not abort the rest — partial offline coverage beats none. Guarded so two
 * triggers (login + reconnect) can't run concurrently.
 */
export async function runPrewarm(
  businessId: string,
  onProgress?: (p: PrewarmProgress) => void,
  tasks: Task[] = PREWARM_TASKS,
): Promise<PrewarmResult> {
  const total = tasks.length;
  if (running) return { completed: 0, total, errors: [] };
  running = true;
  const errors: { key: string; message: string }[] = [];
  let completed = 0;
  try {
    for (const task of tasks) {
      onProgress?.({ done: completed, total, label: task.label });
      try {
        await task.run(businessId);
      } catch (e) {
        errors.push({ key: task.key, message: e instanceof Error ? e.message : String(e) });
      }
      completed += 1;
      onProgress?.({ done: completed, total, label: task.label });
    }
  } finally {
    running = false;
  }
  return { completed, total, errors };
}

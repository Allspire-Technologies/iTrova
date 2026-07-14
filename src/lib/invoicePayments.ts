import { supabase } from "@/integrations/supabase/client";
import type { ReceiptPayment } from "@/lib/receipt";

// sale_payments / sales postdate the generated Supabase types, so cast the client once.
const sb = supabase;

/** The payment-method breakdown for an invoice, resolved at render time:
 *  - POS invoice (has sale_id): from `sale_payments` (falls back to the sale's single method).
 *  - Manual invoice: the recorded `invoice_payments`, grouped by method.
 *  Returns one `{method, amount}` per method (empty if nothing is recorded). */
export async function invoicePaymentBreakdown(inv: { id: string; sale_id: string | null }): Promise<ReceiptPayment[]> {
  if (inv.sale_id) {
    const { data } = await sb.from("sale_payments").select("method,amount").eq("sale_id", inv.sale_id);
    if (data && data.length) return (data as Record<string, unknown>[]).map((r) => ({ method: String(r.method), amount: Number(r.amount) }));
    // Defensive fallback (backfill should mean this is never hit): the sale's single method.
    const { data: s } = await sb.from("sales").select("payment_method,total_amount").eq("id", inv.sale_id).maybeSingle();
    return s ? [{ method: String(s.payment_method ?? "cash"), amount: Number(s.total_amount) }] : [];
  }
  const { data } = await sb.from("invoice_payments").select("method,amount").eq("invoice_id", inv.id);
  const byMethod = new Map<string, number>();
  for (const p of (data ?? []) as Record<string, unknown>[]) {
    const m = String(p.method);
    byMethod.set(m, (byMethod.get(m) ?? 0) + Number(p.amount));
  }
  return [...byMethod.entries()].map(([method, amount]) => ({ method, amount }));
}

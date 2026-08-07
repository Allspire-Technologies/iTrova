import { supabase } from "@/integrations/supabase/client";


export type PaymentStart = {
  method: "transfer" | "card";
  /** Which processor took this payment — display only; the server decides. */
  provider?: "monnify" | "paystack";
  reference: string;
  amount: number;
  quote?: { amount: number; currency: string; list_amount: number; cycle_discount: number; referee_discount: number };
  /** The provider's page for this transaction. The amount is bound to it, so the customer cannot pay
   *  a different figure — for a transfer the provider issues a one-time account for exactly this amount. */
  checkout_url?: string;
  provider_reference?: string | null;
};

/** Start a payment for the signed-in user's own business. */
export async function createPayment(planKey: string, cycle: string, method: "transfer" | "card" = "transfer"): Promise<PaymentStart> {
  const { data, error } = await supabase.functions.invoke<PaymentStart & { error?: string }>("create-payment", {
    // Card payment leaves the app and comes back, so tell the server where "back" is — otherwise a
    // dev or staging user is returned to production and lands on the login page. Allowlisted server-side.
    body: { plan_key: planKey, cycle, method, return_origin: window.location.origin },
  });
  if (error) {
    if ((error as { name?: string }).name === "FunctionsFetchError") {
      throw new Error("Couldn't reach the payment service — deploy it: supabase functions deploy create-payment");
    }
    let message = error.message;
    try { const b = await (error as { context?: Response }).context?.json(); if (b?.error) message = b.error; } catch { /* keep */ }
    throw new Error(message);
  }
  if (!data || (data as { error?: string }).error) throw new Error((data as { error?: string })?.error ?? "Couldn't start the payment.");
  return data;
}

export type BillingHistoryRow = {
  id: string;
  paidAt: string;
  planKey: string | null;
  cycle: string | null;
  amount: number;
  currency: string;
  reference: string | null;
  method: string;
};

/** Every subscription payment for this business — self-serve or recorded by an admin. */
export async function listBillingHistory(): Promise<BillingHistoryRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("my_billing_history");
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    paidAt: String(r.paid_at),
    planKey: r.plan_key == null ? null : String(r.plan_key),
    cycle: r.cycle == null ? null : String(r.cycle),
    amount: Number(r.amount) || 0,
    currency: String(r.currency ?? "NGN"),
    reference: r.reference == null ? null : String(r.reference),
    method: String(r.method ?? "manual"),
  }));
}

/** Has a payment landed yet? Polled while the transfer instructions are on screen.
 *  billing_payment postdates the generated Supabase types — cast until they're regenerated. */
export async function latestPaymentStatus(reference: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from("billing_payment").select("status").eq("our_reference", reference).maybeSingle();
  if (error) return null;
  return (data as { status?: string } | null)?.status ?? null;
}

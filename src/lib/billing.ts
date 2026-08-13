import { supabase } from "@/integrations/supabase/client";


export type PaymentQuote = {
  /** The plan price after both discounts — what this costs before any credit. */
  amount: number;
  currency: string;
  listAmount: number;
  cycleDiscount: number;
  refereeDiscount: number;
  /** Spendable referral credit right now (already net of anything held by a pending checkout). */
  creditAvailable: number;
  /** What would be applied to THIS payment: min(available, amount). */
  creditApplicable: number;
  /** What the provider would be asked for once credit is applied. Zero = no provider needed. */
  amountDue: number;
};

/** Price a plan for the signed-in user's own business, including referral credit. Server-side —
 *  the browser never computes money. */
export async function paymentQuote(planKey: string, cycle: string): Promise<PaymentQuote> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .rpc("my_payment_quote", { p_plan_key: planKey, p_cycle: cycle });
  if (error) throw error;
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!r) throw new Error("Couldn't price that plan.");
  return {
    amount: Number(r.amount) || 0,
    currency: String(r.currency ?? "NGN"),
    listAmount: Number(r.list_amount) || 0,
    cycleDiscount: Number(r.cycle_discount) || 0,
    refereeDiscount: Number(r.referee_discount) || 0,
    creditAvailable: Number(r.credit_available) || 0,
    creditApplicable: Number(r.credit_applicable) || 0,
    amountDue: Number(r.amount_due) || 0,
  };
}

export type PaymentStart = {
  method: "transfer" | "card" | "credit";
  /** Which processor took this payment — display only; the server decides. */
  provider?: "monnify" | "paystack" | "credit";
  reference: string;
  amount: number;
  /** Cash asked of the provider once credit was applied. */
  amount_due?: number;
  credit_applied?: number;
  /** True when referral credit covered the whole price: the plan is already active and there is
   *  no checkout page to send anyone to. */
  activated?: boolean;
  quote?: { amount: number; currency: string; list_amount: number; cycle_discount: number; referee_discount: number };
  /** The provider's page for this transaction. The amount is bound to it, so the customer cannot pay
   *  a different figure — for a transfer the provider issues a one-time account for exactly this amount. */
  checkout_url?: string;
  provider_reference?: string | null;
};

/** Start a payment for the signed-in user's own business. `useCredit` is a yes/no: how much credit
 *  exists, and how much of it applies, is decided server-side. */
export async function createPayment(
  planKey: string, cycle: string, method: "transfer" | "card" = "transfer", useCredit = false,
): Promise<PaymentStart> {
  const { data, error } = await supabase.functions.invoke<PaymentStart & { error?: string }>("create-payment", {
    // Card payment leaves the app and comes back, so tell the server where "back" is — otherwise a
    // dev or staging user is returned to production and lands on the login page. Allowlisted server-side.
    body: { plan_key: planKey, cycle, method, use_credit: useCredit, return_origin: window.location.origin },
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
  /** What the plan cost: cash collected PLUS any referral credit applied. */
  amount: number;
  currency: string;
  reference: string | null;
  method: string;
  /** Referral credit that settled part (or all) of this payment. */
  creditApplied: number;
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
    creditApplied: Number(r.credit_applied) || 0,
  }));
}

/** Has a payment landed yet? Polled while the transfer instructions are on screen.
 *  billing_payment postdates the generated Supabase types — cast until they're regenerated. */
export async function latestPaymentStatus(reference: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from("billing_payment").select("status").eq("our_reference", reference).maybeSingle();
  if (error) {
    // Null also means "not paid yet" to the poller — leave a trace so a broken query is
    // distinguishable from a payment that simply hasn't landed.
    console.error("latestPaymentStatus failed:", error.message);
    return null;
  }
  return (data as { status?: string } | null)?.status ?? null;
}

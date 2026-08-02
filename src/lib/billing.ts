import { supabase } from "@/integrations/supabase/client";

// Subscription collection via Monnify. The browser never sends an amount — create-payment prices the
// plan server-side (cycle discount + any referred-business discount), so what you're charged can't be
// tampered with and always matches what the Billing tab promised.

export type ReservedAccount = { bankName: string; accountNumber: string; accountName?: string; bankCode?: string };

export type PaymentStart = {
  method: "transfer" | "card";
  reference: string;
  amount: number;
  quote?: { amount: number; currency: string; list_amount: number; cycle_discount: number; referee_discount: number };
  accounts?: ReservedAccount[];   // transfer
  checkout_url?: string;          // card
};

/** Start a payment for the signed-in user's own business. */
export async function createPayment(planKey: string, cycle: string, method: "transfer" | "card" = "transfer"): Promise<PaymentStart> {
  const { data, error } = await supabase.functions.invoke<PaymentStart & { error?: string }>("create-payment", {
    body: { plan_key: planKey, cycle, method },
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

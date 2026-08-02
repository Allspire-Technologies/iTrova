// monnify-webhook — Monnify calls this when money arrives. It is the only thing that can grant a
// subscription without a human, so it is deliberately paranoid:
//
//   1. Verify the HMAC SHA-512 signature over the RAW body. Without this, anyone who learns the URL
//      can activate free subscriptions.
//   2. Re-read the transaction from Monnify's API. A valid-looking payload is not proof of payment.
//   3. Hand off to activate_subscription_from_payment(), which is service_role-only and idempotent —
//      Monnify retries, and a repeat must not activate twice or double-count the money (which would
//      inflate referral commission).
//
// Deploy WITHOUT a JWT check — Monnify has no Supabase token:
//   supabase functions deploy monnify-webhook --no-verify-jwt
// Then set this URL as the webhook in the Monnify dashboard.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyWebhookSignature, getTransaction } from "../_shared/monnify.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // The signature is over the exact bytes Monnify sent — read the body as text, never re-serialise.
  const raw = await req.text();
  const signature = req.headers.get("monnify-signature");
  if (!(await verifyWebhookSignature(raw, signature))) {
    console.warn("monnify-webhook: bad signature, rejected");
    return json({ error: "invalid signature" }, 401);
  }

  let payload: Record<string, any>;
  try { payload = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }

  const event = payload?.eventType ?? payload?.eventData?.eventType;
  const data = payload?.eventData ?? payload;
  const ourReference: string | undefined = data?.paymentReference;
  const providerReference: string | undefined = data?.transactionReference;

  // Only successful collections activate anything; log the rest and acknowledge so Monnify stops retrying.
  if (event && event !== "SUCCESSFUL_TRANSACTION") {
    console.log("monnify-webhook: ignoring event", event);
    return json({ ok: true, ignored: event });
  }
  if (!ourReference) return json({ ok: true, ignored: "no paymentReference" });

  try {
    // Independent confirmation: ask Monnify what it thinks happened.
    let amountPaid = Number(data?.amountPaid ?? 0);
    let confirmed = false;
    if (providerReference) {
      const tx = await getTransaction(providerReference);
      const status = String((tx as any)?.paymentStatus ?? "");
      amountPaid = Number((tx as any)?.amountPaid ?? amountPaid);
      confirmed = status === "PAID";
      if (!confirmed) {
        console.warn("monnify-webhook: transaction not PAID", providerReference, status);
        return json({ ok: true, ignored: `status ${status}` });
      }
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: result, error } = await admin.rpc("activate_subscription_from_payment", {
      p_our_reference: ourReference,
      p_provider_reference: providerReference ?? null,
      p_amount_paid: amountPaid,
      p_raw: payload,
    });
    if (error) {
      // 500 so Monnify retries — the money arrived, we just failed to record it.
      console.error("monnify-webhook: activation failed", error.message);
      return json({ error: error.message }, 500);
    }
    console.log("monnify-webhook:", JSON.stringify(result));
    return json({ ok: true, result });
  } catch (e) {
    console.error("monnify-webhook error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

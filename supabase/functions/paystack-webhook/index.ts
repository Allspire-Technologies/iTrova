// paystack-webhook — Paystack calls this when money arrives. Like monnify-webhook, it can grant a
// subscription without a human, so it is deliberately paranoid:
//
//   1. Verify the HMAC SHA-512 signature (x-paystack-signature) over the RAW body. Without this,
//      anyone who learns the URL can activate free subscriptions.
//   2. Re-read the transaction from Paystack's verify API. A valid-looking payload is not proof
//      of payment — the payload alone never grants a plan.
//   3. Require currency NGN and convert KOBO → naira exactly once, then hand off to
//      activate_subscription_from_payment(), which is service_role-only and idempotent.
//      Only an EXACT amount activates a plan.
//
// Self-contained on purpose — it can be pasted straight into the Supabase dashboard's function
// editor, which has no sibling _shared/ folder to import from.
//
// Secrets required: PAYSTACK_SECRET_KEY (test = sk_test_…, live = sk_live_… — mode is IN THE KEY;
// the API host is the same for both).
//
// IMPORTANT: deploy WITHOUT a JWT check — Paystack has no Supabase token.
//   Dashboard: turn OFF "Verify JWT with legacy secret" for this function.
//   CLI:       supabase functions deploy paystack-webhook --no-verify-jwt
// Then set this URL as the webhook in the Paystack dashboard (test and live are configured
// SEPARATELY — setting one does not set the other).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET = () => Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// A stalled Paystack connection must not hold the invocation until the platform kills it.
const DEADLINE = () => AbortSignal.timeout(15_000);

/** Paystack signs webhooks with HMAC SHA-512 of the RAW body, keyed by the secret key. */
async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(PAYSTACK_SECRET()),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare — an early-exit check leaks the signature byte by byte.
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(signature.trim().toLowerCase());
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Independent confirmation straight from Paystack — the webhook payload alone never grants a plan. */
async function verifyTransaction(reference: string): Promise<Record<string, any>> {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET()}` },
    signal: DEADLINE(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.status !== true) {
    throw new Error(`Paystack verify failed (${res.status}): ${body?.message ?? "unknown error"}`);
  }
  return body?.data ?? {};
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Without the secret, signature verification would run against an empty HMAC key —
  // misconfiguration must fail loudly, not quietly reject (or worse, accept) webhooks.
  if (!PAYSTACK_SECRET()) {
    console.error("paystack-webhook: PAYSTACK_SECRET_KEY not configured");
    return json({ error: "not configured" }, 500);
  }

  // The signature covers the exact bytes Paystack sent — read as text, never re-serialise.
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("x-paystack-signature")))) {
    console.warn("paystack-webhook: bad signature, rejected");
    return json({ error: "invalid signature" }, 401);
  }

  let payload: Record<string, any>;
  try { payload = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }

  const event = payload?.event;
  const data = payload?.data ?? {};
  const ourReference: string | undefined = data?.reference;   // we set OUR ITV-… reference at init

  // Acknowledge anything that isn't a successful charge so Paystack stops retrying it.
  if (event !== "charge.success") {
    console.log("paystack-webhook: ignoring event", event ?? "(none)");
    return json({ ok: true, ignored: event ?? "no event" });
  }
  if (!ourReference) return json({ ok: true, ignored: "no reference" });

  try {
    const tx = await verifyTransaction(ourReference);
    const status = String(tx?.status ?? "");
    const currency = String(tx?.currency ?? "");
    const amountKobo = Number(tx?.amount ?? 0);
    if (status !== "success") {
      console.warn("paystack-webhook: transaction not success", ourReference, status);
      return json({ ok: true, ignored: `status ${status}` });
    }
    // 4,500 of some other currency must not buy a ₦4,500 plan.
    if (currency !== "NGN") {
      console.warn("paystack-webhook: unexpected currency", ourReference, currency);
      return json({ ok: true, ignored: `currency ${currency}` });
    }
    // Paystack amounts are in KOBO — divide by 100 exactly once; the activation RPC compares naira.
    const amountPaid = amountKobo / 100;
    const providerReference = tx?.id != null ? String(tx.id) : null;

    // Keep only what reconciliation needs — the full payload carries payer identity and card
    // metadata, and billing_payment.raw is readable by the paying business.
    const auditRaw = {
      event,
      reference: ourReference,
      transactionId: providerReference,
      amountKobo,
      amountPaid,
      currency,
      paidAt: tx?.paid_at ?? null,
      channel: tx?.channel ?? null,
    };

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: result, error } = await admin.rpc("activate_subscription_from_payment", {
      p_our_reference: ourReference,
      p_provider_reference: providerReference,
      p_amount_paid: amountPaid,
      p_raw: auditRaw,
    });
    if (error) {
      // 500 so Paystack retries — the money arrived, we just failed to record it.
      console.error("paystack-webhook: activation failed", error.message);
      return json({ error: error.message }, 500);
    }
    console.log("paystack-webhook:", JSON.stringify(result));
    return json({ ok: true, result });
  } catch (e) {
    console.error("paystack-webhook error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});

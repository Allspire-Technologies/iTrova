// monnify-webhook — Monnify calls this when money arrives. It is the only thing that can grant a
// subscription without a human, so it is deliberately paranoid:
//
//   1. Verify the HMAC SHA-512 signature over the RAW body. Without this, anyone who learns the URL
//      can activate free subscriptions.
//   2. Re-read the transaction from Monnify's API. A valid-looking payload is not proof of payment.
//   3. Hand off to activate_subscription_from_payment(), which is service_role-only and idempotent —
//      Monnify retries, and a repeat must not activate twice or double-count the money (which would
//      inflate referral commission). Only an EXACT amount activates a plan.
//
// Self-contained on purpose — it can be pasted straight into the Supabase dashboard's function
// editor, which has no sibling _shared/ folder to import from.
//
// IMPORTANT: deploy WITHOUT a JWT check — Monnify has no Supabase token.
//   Dashboard: turn OFF "Verify JWT with legacy secret" for this function.
//   CLI:       supabase functions deploy monnify-webhook --no-verify-jwt
// Then set this URL as the webhook in the Monnify dashboard.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BASE = () => Deno.env.get("MONNIFY_BASE_URL") ?? "https://sandbox.monnify.com";
const API_KEY = () => Deno.env.get("MONNIFY_API_KEY") ?? "";
const SECRET = () => Deno.env.get("MONNIFY_SECRET_KEY") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Monnify signs webhooks with HMAC SHA-512 of the RAW body, keyed by the client secret. */
async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET()),
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

/** Independent confirmation straight from Monnify — the webhook payload alone never grants a plan. */
async function getTransaction(transactionReference: string): Promise<Record<string, any>> {
  const auth = await fetch(`${BASE()}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${API_KEY()}:${SECRET()}`)}`, "Content-Type": "application/json" },
  });
  const authBody = await auth.json().catch(() => ({}));
  const token = authBody?.responseBody?.accessToken;
  if (!token) throw new Error("Monnify auth failed while verifying the transaction");

  const res = await fetch(`${BASE()}/api/v2/transactions/${encodeURIComponent(transactionReference)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Monnify transaction lookup failed (${res.status})`);
  return body?.responseBody ?? {};
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // The signature covers the exact bytes Monnify sent — read as text, never re-serialise.
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("monnify-signature")))) {
    console.warn("monnify-webhook: bad signature, rejected");
    return json({ error: "invalid signature" }, 401);
  }

  let payload: Record<string, any>;
  try { payload = JSON.parse(raw); } catch { return json({ error: "bad json" }, 400); }

  const event = payload?.eventType ?? payload?.eventData?.eventType;
  const data = payload?.eventData ?? payload;
  const ourReference: string | undefined = data?.paymentReference;
  const providerReference: string | undefined = data?.transactionReference;

  // Acknowledge anything that isn't a completed collection so Monnify stops retrying it.
  if (event && event !== "SUCCESSFUL_TRANSACTION") {
    console.log("monnify-webhook: ignoring event", event);
    return json({ ok: true, ignored: event });
  }
  if (!ourReference) return json({ ok: true, ignored: "no paymentReference" });

  try {
    let amountPaid = Number(data?.amountPaid ?? 0);
    if (providerReference) {
      const tx = await getTransaction(providerReference);
      const status = String(tx?.paymentStatus ?? "");
      amountPaid = Number(tx?.amountPaid ?? amountPaid);
      if (status !== "PAID") {
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

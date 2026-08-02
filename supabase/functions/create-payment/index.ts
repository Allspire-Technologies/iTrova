// create-payment — starts a subscription payment for the CALLER'S OWN business.
//
// The browser sends only { plan_key, cycle, method }. It never sends an amount: the price is read
// server-side from quote_subscription_price(), which applies the cycle discount and the referred-
// business first-payment discount. So a tampered request cannot buy Enterprise for ₦100, and a
// referred business is charged exactly what iTrova promised it.
//
// Self-contained on purpose — it can be pasted straight into the Supabase dashboard's function
// editor, which has no sibling _shared/ folder to import from.
//
// Secrets required: MONNIFY_API_KEY, MONNIFY_SECRET_KEY, MONNIFY_CONTRACT_CODE, MONNIFY_BASE_URL
// (SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY are injected automatically.)
// Deploy with verify_jwt ON — the caller's JWT identifies the business.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BASE = () => Deno.env.get("MONNIFY_BASE_URL") ?? "https://sandbox.monnify.com";
const API_KEY = () => Deno.env.get("MONNIFY_API_KEY") ?? "";
const SECRET = () => Deno.env.get("MONNIFY_SECRET_KEY") ?? "";
const CONTRACT = () => Deno.env.get("MONNIFY_CONTRACT_CODE") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Bearer token for Monnify's REST API. Short-lived, so fetched per invocation rather than cached. */
async function monnifyToken(): Promise<string> {
  const res = await fetch(`${BASE()}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${API_KEY()}:${SECRET()}`)}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  const t = body?.responseBody?.accessToken;
  if (!res.ok || !t) throw new Error(`Monnify auth failed (${res.status}): ${body?.responseMessage ?? "no token"}`);
  return t;
}

async function monnify(path: string, init: RequestInit = {}): Promise<Record<string, any>> {
  const t = await monnifyToken();
  const res = await fetch(`${BASE()}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.requestSuccessful === false) {
    throw new Error(`Monnify ${path} failed (${res.status}): ${body?.responseMessage ?? "unknown error"}`);
  }
  return body?.responseBody ?? {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!API_KEY() || !SECRET() || !CONTRACT()) {
      return json({ error: "Monnify isn't configured — set MONNIFY_API_KEY, MONNIFY_SECRET_KEY and MONNIFY_CONTRACT_CODE." }, 500);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identify the caller from their JWT; everything below is scoped to their own business.
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userRes } = await caller.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: "Sign in to pay." }, 401);

    const { data: bizId, error: bizErr } = await caller.rpc("current_business_id");
    if (bizErr || !bizId) return json({ error: "No business found for this account." }, 403);

    const { plan_key, cycle, method = "transfer", return_origin } = await req.json().catch(() => ({}));
    if (!plan_key || !cycle) return json({ error: "A plan and billing cycle are required." }, 400);
    if (!["transfer", "card"].includes(method)) return json({ error: "Unsupported payment method." }, 400);

    // Card payment sends the user off to Monnify and back, so we must return them to the origin they
    // actually started from — a hardcoded URL drops a dev or staging user onto production, where
    // they have no session and land on the login page. Validated against an allowlist: this value
    // comes from the browser, and an unchecked redirect target is an open-redirect for phishing.
    const ALLOWED = [
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
      /^https:\/\/([a-z0-9-]+\.)*allspire\.tech$/,
      /^https:\/\/[a-z0-9-]+\.workers\.dev$/,
    ];
    const fallback = Deno.env.get("APP_URL") ?? "https://itrova.allspire.tech";
    const origin = typeof return_origin === "string" && ALLOWED.some((re) => re.test(return_origin))
      ? return_origin
      : fallback;

    const admin = createClient(url, service);

    // ---- Price it SERVER-SIDE. This is the only place an amount comes from.
    const { data: quoteRows, error: quoteErr } = await admin
      .rpc("quote_subscription_price", { p_business_id: bizId, p_plan_key: plan_key, p_cycle: cycle });
    if (quoteErr) return json({ error: quoteErr.message }, 400);
    const quote = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
    const amount = Number(quote?.amount ?? 0);
    if (!(amount > 0)) return json({ error: "That plan has no payable price." }, 400);

    const { data: biz } = await admin.from("businesses").select("name").eq("id", bizId).maybeSingle();
    const businessName = biz?.name ?? "iTrova customer";
    const email = user.email ?? `${bizId}@no-email.itrova`;

    // ---- Record the intent first, so the webhook has something to match against.
    const ourReference = `ITV-${String(bizId).slice(0, 8)}-${Date.now()}`;
    const { error: insErr } = await admin.from("billing_payment").insert({
      business_id: bizId, plan_key, cycle, amount, currency: quote?.currency ?? "NGN",
      method, our_reference: ourReference, created_by: user.id,
    });
    if (insErr) return json({ error: insErr.message }, 500);

    // ---- Both methods go through init-transaction, which BINDS THE AMOUNT to the transaction.
    // For a transfer Monnify then issues a one-time account for exactly this figure, so a wrong
    // amount can't be sent in the first place. (A permanent reserved account would accept any
    // amount from anyone, forever, leaving us to reject money after it had already arrived.)
    const tx = await monnify("/api/v1/merchant/transactions/init-transaction", {
      method: "POST",
      body: JSON.stringify({
        amount, customerName: businessName.slice(0, 100), customerEmail: email,
        paymentReference: ourReference,
        paymentDescription: `iTrova ${plan_key} (${cycle})`.slice(0, 100),
        currencyCode: "NGN", contractCode: CONTRACT(),
        redirectUrl: `${origin}/settings?tab=billing&paid=${encodeURIComponent(ourReference)}`,
        // Open Monnify on the method the customer picked; the amount is fixed either way.
        paymentMethods: method === "card" ? ["CARD"] : ["ACCOUNT_TRANSFER"],
      }),
    });

    await admin.from("billing_payment")
      .update({ provider_reference: tx?.transactionReference ?? null })
      .eq("our_reference", ourReference);

    return json({
      method, reference: ourReference, amount, quote,
      checkout_url: tx?.checkoutUrl,
      provider_reference: tx?.transactionReference ?? null,
    });
  } catch (e) {
    // Never leak Monnify's raw error to the browser; it goes to this function's logs instead.
    console.error("create-payment failed:", e);
    return json({ error: (e as Error).message ?? "Couldn't start the payment." }, 500);
  }
});

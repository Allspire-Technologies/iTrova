// create-payment — starts a subscription payment for the CALLER'S OWN business.
//
// The browser sends only { plan_key, cycle, method, use_credit }. It never sends an amount, a
// provider, OR a credit figure — use_credit is a yes/no and the balance is computed here:
// the price is read server-side from quote_subscription_price(), which applies the cycle discount
// and the referred-business first-payment discount, and the provider (Monnify or Paystack) comes
// from the billing_config row the platform team controls. So a tampered request cannot buy
// Enterprise for ₦100, and it cannot route itself to a provider we didn't choose.
//
// Self-contained on purpose — it can be pasted straight into the Supabase dashboard's function
// editor, which has no sibling _shared/ folder to import from.
//
// Secrets required:
//   Monnify:  MONNIFY_API_KEY, MONNIFY_SECRET_KEY, MONNIFY_CONTRACT_CODE, MONNIFY_BASE_URL
//   Paystack: PAYSTACK_SECRET_KEY  (test = sk_test_…, live = sk_live_… — mode is IN THE KEY)
// (SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY are injected automatically.)
// Deploy with verify_jwt ON — the caller's JWT identifies the business.
// Pinned exact version — a floating @2 could silently change behaviour between cold starts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

// No default host: sandbox-vs-live must be an explicit choice. An unset MONNIFY_BASE_URL on
// production would otherwise send real customers to the sandbox; the config check below
// rejects Monnify payments until it is set.
const BASE = () => Deno.env.get("MONNIFY_BASE_URL") ?? "";
const API_KEY = () => Deno.env.get("MONNIFY_API_KEY") ?? "";
const SECRET = () => Deno.env.get("MONNIFY_SECRET_KEY") ?? "";
const CONTRACT = () => Deno.env.get("MONNIFY_CONTRACT_CODE") ?? "";
const PAYSTACK_SECRET = () => Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// A stalled provider connection must not hold the invocation until the platform kills it.
const DEADLINE = () => AbortSignal.timeout(15_000);

/** Bearer token for Monnify's REST API. Short-lived, so fetched per invocation rather than cached. */
async function monnifyToken(): Promise<string> {
  const res = await fetch(`${BASE()}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${API_KEY()}:${SECRET()}`)}`, "Content-Type": "application/json" },
    signal: DEADLINE(),
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
    signal: DEADLINE(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.requestSuccessful === false) {
    throw new Error(`Monnify ${path} failed (${res.status}): ${body?.responseMessage ?? "unknown error"}`);
  }
  return body?.responseBody ?? {};
}

async function paystackInit(payload: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET()}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: DEADLINE(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.status !== true) {
    throw new Error(`Paystack initialize failed (${res.status}): ${body?.message ?? "unknown error"}`);
  }
  return body?.data ?? {};
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
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

    const admin = createClient(url, service);

    // Only the owner commits the business to a subscription. Staff paying the business's bill
    // wouldn't lose anyone money, but plan changes are an owner decision — same gate as
    // set_subscription_cancel.
    const { data: isOwner, error: ownerErr } = await admin
      .rpc("has_business_role", { _business_id: bizId, _user_id: user.id, _role: "owner" });
    if (ownerErr) return json({ error: ownerErr.message }, 500);
    if (!isOwner) return json({ error: "Only the business owner can pay for a subscription." }, 403);

    const { plan_key, cycle, method = "transfer", return_origin, use_credit } = await req.json().catch(() => ({}));
    if (!plan_key || !cycle) return json({ error: "A plan and billing cycle are required." }, 400);
    if (!["transfer", "card"].includes(method)) return json({ error: "Unsupported payment method." }, 400);

    // ---- Price it SERVER-SIDE. This is the only place an amount comes from.
    const { data: quoteRows, error: quoteErr } = await admin
      .rpc("quote_subscription_price", { p_business_id: bizId, p_plan_key: plan_key, p_cycle: cycle });
    if (quoteErr) return json({ error: quoteErr.message }, 400);
    const quote = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
    const amount = Number(quote?.amount ?? 0);
    if (!(amount > 0)) return json({ error: "That plan has no payable price." }, 400);

    // ---- Referral credit, also server-side. The browser sends a yes/no, never a figure: how much
    // credit exists is ours to compute, and min(available, price) is applied so the customer can
    // never spend more credit than the plan costs (the excess stays on their balance).
    //
    // This read is ADVISORY — it only decides which path to take below. Every figure that ends up
    // costing anyone money is re-derived inside a locked RPC, because a read here followed by a
    // write later is exactly the race that lets two concurrent payments claim one balance.
    let creditApplied = 0;
    if (use_credit === true) {
      const { data: creditRaw, error: creditErr } = await admin
        .rpc("_referral_credit", { p_business_id: bizId });
      if (creditErr) {
        console.error("create-payment: referral credit read failed:", creditErr.message);
        return json({ error: "Couldn't check your referral credit. Please try again." }, 500);
      }
      creditApplied = Math.min(Number(creditRaw ?? 0), amount);
    }
    const due = Math.max(0, amount - creditApplied);

    // ---- Fully covered by credit: no provider, no checkout page, no money to move. The RPC
    // re-reads BOTH the price and the balance under a row lock before activating, so this call
    // is a request to activate, not an instruction the Edge Function can get wrong.
    if (due === 0) {
      const { data: act, error: actErr } = await admin.rpc("activate_subscription_with_credit", {
        p_business_id: bizId, p_plan_key: plan_key, p_cycle: cycle, p_actor: user.id,
      });
      if (actErr) {
        console.error("create-payment: credit activation failed:", actErr.message);
        return json({ error: "Couldn't apply your credit. Please try again." }, 500);
      }
      if (!act?.ok) {
        // Balance moved between the quote and the lock (a concurrent spend). Ask them to retry
        // rather than silently charging a card they didn't expect to use.
        console.error("create-payment: credit activation refused:", JSON.stringify(act));
        return json({ error: "Your referral credit no longer covers this plan. Please reopen the payment." }, 409);
      }
      return json({
        activated: true, provider: "credit", method: "credit",
        reference: act.reference, amount, amount_due: 0,
        credit_applied: Number(act.credit_applied ?? creditApplied), quote,
      });
    }

    // ---- Which provider serves this payment is OUR call, read server-side. A failed read
    // aborts: routing money on a guess is worse than asking the customer to retry. Monnify is
    // the default only when the read SUCCEEDS and no row exists yet.
    const { data: cfg, error: cfgErr } = await admin.from("billing_config").select("active_provider").maybeSingle();
    if (cfgErr) {
      console.error("create-payment: billing_config read failed:", cfgErr.message);
      return json({ error: "Couldn't start the payment. Please try again." }, 500);
    }
    const provider: "monnify" | "paystack" = cfg?.active_provider === "paystack" ? "paystack" : "monnify";
    if (provider === "paystack" && !PAYSTACK_SECRET()) {
      return json({ error: "Payments aren't configured — set PAYSTACK_SECRET_KEY." }, 500);
    }
    if (provider === "monnify" && (!API_KEY() || !SECRET() || !CONTRACT() || !BASE())) {
      return json({ error: "Payments aren't configured — set MONNIFY_API_KEY, MONNIFY_SECRET_KEY, MONNIFY_CONTRACT_CODE and MONNIFY_BASE_URL." }, 500);
    }

    // Card payment sends the user off to the provider and back, so we must return them to the origin
    // they actually started from — a hardcoded URL drops a dev or staging user onto production, where
    // they have no session and land on the login page. Validated against an allowlist: this value
    // comes from the browser, and an unchecked redirect target is an open-redirect for phishing.
    const ALLOWED = [
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
      /^https:\/\/([a-z0-9-]+\.)*allspire\.tech$/,
      // Pinned to OUR workers, not *.workers.dev — anyone can register a workers.dev subdomain,
      // which would make this an open redirect again.
      /^https:\/\/itrova(-staging)?\.techallspire\.workers\.dev$/,
    ];
    const fallback = Deno.env.get("APP_URL") ?? "https://itrova.allspire.tech";
    const origin = typeof return_origin === "string" && ALLOWED.some((re) => re.test(return_origin))
      ? return_origin
      : fallback;

    const { data: biz } = await admin.from("businesses").select("name").eq("id", bizId).maybeSingle();
    const businessName = biz?.name ?? "iTrova customer";
    const email = user.email ?? `${bizId}@no-email.itrova`;

    // ---- Record the intent BEFORE asking the provider for anything, so the webhook always has
    // something to match against.
    const ourReference = `ITV-${String(bizId).slice(0, 8)}-${Date.now()}`;
    // Opened ATOMICALLY: the RPC locks the business row, re-reads the price and the
    // balance, sizes the credit and writes the row in one transaction. Doing that read here and
    // the insert separately let two payments started at the same moment both claim one balance.
    // It also returns fully_covered if the credit grew since the advisory read above.
    const { data: intent, error: intentErr } = await admin.rpc("create_payment_intent", {
      p_business_id: bizId, p_plan_key: plan_key, p_cycle: cycle, p_method: method,
      p_provider: provider, p_use_credit: use_credit === true,
      p_our_reference: ourReference, p_actor: user.id,
    });
    if (intentErr) {
      console.error("create-payment: opening the intent failed:", intentErr.message);
      return json({ error: "Couldn't start the payment. Please try again." }, 500);
    }
    if (!intent?.ok) return json({ error: intent?.error ?? "Couldn't start the payment." }, 400);

    if (intent.fully_covered) {
      const { data: act, error: actErr } = await admin.rpc("activate_subscription_with_credit", {
        p_business_id: bizId, p_plan_key: plan_key, p_cycle: cycle, p_actor: user.id,
      });
      if (actErr || !act?.ok) {
        console.error("create-payment: credit activation failed:", actErr?.message ?? JSON.stringify(act));
        return json({ error: "Couldn't apply your credit. Please reopen the payment." }, 409);
      }
      return json({
        activated: true, provider: "credit", method: "credit",
        reference: act.reference, amount, amount_due: 0,
        credit_applied: Number(act.credit_applied ?? 0), quote,
      });
    }

    // The provider is asked for the CASH figure the intent settled on; credit_applied carries the
    // rest of the price. The activation's exact-amount check compares against that cash figure, so
    // a part-credit payment is verified exactly like any other, and the credit is debited only on
    // success.
    const cashDue = Number(intent.due);
    creditApplied = Number(intent.credit_applied ?? 0);

    const redirectUrl = `${origin}/settings?tab=billing&paid=${encodeURIComponent(ourReference)}`;

    // ---- Both providers BIND THE AMOUNT to the transaction at init, so a wrong amount can't be
    // sent in the first place: Monnify's init-transaction issues a one-time account for exactly
    // this figure; Paystack's initialize fixes the charge (and its pay-with-transfer account) too.
    let checkoutUrl: string | undefined;
    let providerReference: string | null = null;

    if (provider === "paystack") {
      // Paystack amounts are in KOBO — this ×100 is the only init-side conversion; the webhook
      // divides by 100 exactly once before the exact-amount check.
      const data = await paystackInit({
        email,
        amount: Math.round(cashDue * 100),
        currency: "NGN",
        reference: ourReference,          // Paystack echoes OUR reference on webhook + verify
        callback_url: redirectUrl,
        channels: method === "card" ? ["card"] : ["bank_transfer"],
        metadata: { business_id: bizId, plan_key, cycle, business_name: businessName.slice(0, 100) },
      });
      checkoutUrl = data?.authorization_url;
      // Stays null until the webhook writes Paystack's transaction id — storing the init-time
      // access_code here would leave pending rows holding a different identifier type than paid ones.
      providerReference = null;
    } else {
      const tx = await monnify("/api/v1/merchant/transactions/init-transaction", {
        method: "POST",
        body: JSON.stringify({
          amount: cashDue, customerName: businessName.slice(0, 100), customerEmail: email,
          paymentReference: ourReference,
          paymentDescription: `iTrova ${plan_key} (${cycle})`.slice(0, 100),
          currencyCode: "NGN", contractCode: CONTRACT(),
          redirectUrl,
          // Open the provider on the method the customer picked; the amount is fixed either way.
          paymentMethods: method === "card" ? ["CARD"] : ["ACCOUNT_TRANSFER"],
        }),
      });
      checkoutUrl = tx?.checkoutUrl;
      providerReference = tx?.transactionReference ?? null;
    }

    // Paystack rows keep provider_reference null until the webhook writes the transaction id,
    // so there is nothing to persist on that path. A failure here is logged but not fatal:
    // the webhook matches by our_reference, so the payment still completes.
    if (providerReference !== null) {
      const { error: refErr } = await admin.from("billing_payment")
        .update({ provider_reference: providerReference })
        .eq("our_reference", ourReference);
      if (refErr) console.error("create-payment: storing provider_reference failed:", refErr.message);
    }

    return json({
      method, provider, reference: ourReference, amount, quote,
      amount_due: cashDue, credit_applied: creditApplied,
      checkout_url: checkoutUrl,
      provider_reference: providerReference,
    });
  } catch (e) {
    // Never leak the provider's raw error to the browser; it goes to this function's logs instead.
    console.error("create-payment failed:", e);
    return json({ error: "Couldn't start the payment. Please try again." }, 500);
  }
});

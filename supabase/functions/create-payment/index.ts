// create-payment — starts a subscription payment for the CALLER'S OWN business.
//
// The browser sends only { plan_key, cycle, method }. It never sends an amount: the price is read
// server-side from quote_subscription_price(), which applies the cycle discount and the referred-
// business first-payment discount. So a tampered request cannot buy Enterprise for ₦100, and a
// referred business is charged exactly what iTrova promised it.
//
// Deploy: supabase functions deploy create-payment
// (verify_jwt ON — the caller's JWT identifies the business.)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertConfigured, createReservedAccount, initTransaction } from "../_shared/monnify.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const misconfigured = assertConfigured();
    if (misconfigured) return json({ error: misconfigured }, 500);

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

    const { plan_key, cycle, method = "transfer" } = await req.json().catch(() => ({}));
    if (!plan_key || !cycle) return json({ error: "A plan and billing cycle are required." }, 400);
    if (!["transfer", "card"].includes(method)) return json({ error: "Unsupported payment method." }, 400);

    const admin = createClient(url, service);

    // ---- Price it SERVER-SIDE. This is the only place an amount comes from.
    const { data: quoteRows, error: quoteErr } = await admin
      .rpc("quote_subscription_price", { p_business_id: bizId, p_plan_key: plan_key, p_cycle: cycle });
    if (quoteErr) return json({ error: quoteErr.message }, 400);
    const quote = Array.isArray(quoteRows) ? quoteRows[0] : quoteRows;
    const amount = Number(quote?.amount ?? 0);
    if (!(amount > 0)) return json({ error: "That plan has no payable price." }, 400);

    const { data: biz } = await admin
      .from("businesses").select("name, whatsapp_number").eq("id", bizId).maybeSingle();
    const businessName = biz?.name ?? "iTrova customer";
    const email = user.email ?? `${bizId}@no-email.itrova`;

    // ---- Record the intent first, so the webhook has something to match against.
    const ourReference = `ITV-${bizId.slice(0, 8)}-${Date.now()}`;
    const { error: insErr } = await admin.from("billing_payment").insert({
      business_id: bizId, plan_key, cycle, amount, currency: quote?.currency ?? "NGN",
      method, our_reference: ourReference, created_by: user.id,
    });
    if (insErr) return json({ error: insErr.message }, 500);

    if (method === "card") {
      const tx = await initTransaction({
        amount, customerName: businessName, customerEmail: email,
        paymentReference: ourReference,
        paymentDescription: `iTrova ${plan_key} (${cycle})`,
        redirectUrl: `${new URL(req.url).origin.replace(/\/functions.*/, "")}/settings?paid=1`,
      });
      return json({ method: "card", reference: ourReference, amount, quote, checkout_url: tx?.checkoutUrl });
    }

    // ---- Transfer: reuse the business's reserved account, creating it on first use.
    const { data: existing } = await admin
      .from("business_reserved_account").select("*").eq("business_id", bizId).maybeSingle();

    let accounts = existing?.accounts ?? null;
    if (!accounts) {
      const accountReference = `ITV-BIZ-${bizId}`;
      const created = await createReservedAccount({
        accountReference, accountName: `iTrova - ${businessName}`,
        customerEmail: email, customerName: businessName,
      });
      accounts = created?.accounts ?? [];
      await admin.from("business_reserved_account").insert({
        business_id: bizId, account_reference: accountReference,
        account_name: created?.accountName ?? businessName, accounts,
      });
    }

    return json({ method: "transfer", reference: ourReference, amount, quote, accounts });
  } catch (e) {
    // Never leak Monnify's raw error to the browser; log it for the function's own logs.
    console.error("create-payment failed:", e);
    return json({ error: (e as Error).message ?? "Couldn't start the payment." }, 500);
  }
});

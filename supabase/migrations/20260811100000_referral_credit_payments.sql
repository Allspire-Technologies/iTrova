-- Spend referral credit on a renewal or upgrade.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- A business that refers others earns credit (business_share_percent of its referees' first-year
-- subscription value). Until now the Refer & earn card told them to "contact us" and a CRM admin
-- recorded a payout by hand. This makes it self-serve: credit offsets the price at checkout, the
-- provider is asked only for the remainder, and a fully-covered plan activates with no provider at
-- all.
--
-- Decisions (product):
--   * Credit applies all-or-nothing per payment: min(available, price). No partial-amount entry.
--   * The referred-business first-payment discount applies FIRST, then credit offsets the rest.
--   * Credit is not cash: cs_renewal_payment records only the money actually collected, so revenue
--     and referral commission never count credit as income.
--   * No clawback. Available credit floors at zero if the earned estimate later falls.
--
-- Ledger: cs_referral_payout (the CRM's payout table) already defines "credit already given" —
-- my_referral_earnings subtracts it. Spending credit writes a row there, so the app, the CRM and
-- this migration all read one balance and cannot disagree.

-- ---------------------------------------------------------------- 1. the payment carries its credit
alter table public.billing_payment
  add column if not exists credit_applied numeric not null default 0 check (credit_applied >= 0);
comment on column public.billing_payment.credit_applied is
  'Referral credit funding this payment. amount = cash asked of the provider; amount + credit_applied '
  '= the plan price. Debited to cs_referral_payout only when the payment is confirmed.';

-- 'credit' joins the method list for fully-covered payments (no provider involved).
alter table public.billing_payment drop constraint if exists billing_payment_method_check;
alter table public.billing_payment add constraint billing_payment_method_check
  check (method in ('transfer', 'card', 'credit'));

-- A fully-covered payment asks the provider for nothing, so the amount check must allow 0.
-- (It already did — `check (amount >= 0)` — restated here so re-running this file is enough
-- to reason about the invariant.)

-- ---------------------------------------------------------------- 2. what credit is available
-- earned − already given − held by pending payments, floored at zero.
--
-- earned mirrors my_referral_earnings (the same cs_referral_revenue view the CRM reads), but takes
-- the business as an argument: the Edge Function prices as service_role, where there is no
-- current_business_id. Guarded on the view existing so this file also applies to an environment
-- without the CRM's migrations — credit is simply 0 there.
--
-- The hold stops one balance being spent twice from two tabs: a pending payment's credit is
-- unavailable until it completes or its intent goes stale. Expiry is lazy (no cron) — a checkout
-- older than an hour has been abandoned in practice, and the provider's own session is long gone.
create or replace function public._referral_credit(p_business_id uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_code text; v_share numeric; v_earned numeric := 0; v_given numeric; v_held numeric;
begin
  if p_business_id is null then return 0; end if;
  if to_regclass('public.cs_referral_revenue') is null then return 0; end if;

  select referral_code into v_code from public.businesses where id = p_business_id;
  if v_code is null then return 0; end if;   -- never generated a code → never referred anyone
  select business_share_percent into v_share from public.referral_config limit 1;

  select coalesce(sum(case when rv.converted
                           then round(coalesce(rv.revenue, 0) * coalesce(v_share, 0) / 100.0) else 0 end), 0)
    into v_earned
    from public.businesses rb
    join public.cs_referral_revenue rv on rv.business_id = rb.id
   where upper(rb.referred_by_code) = upper(v_code);

  select coalesce(sum(amount), 0) into v_given
    from public.cs_referral_payout where business_id = p_business_id;

  select coalesce(sum(credit_applied), 0) into v_held
    from public.billing_payment
   where business_id = p_business_id and status = 'pending'
     and credit_applied > 0 and created_at > now() - interval '1 hour';

  return greatest(0, coalesce(v_earned, 0) - coalesce(v_given, 0) - coalesce(v_held, 0));
end $$;
revoke all on function public._referral_credit(uuid) from public, anon, authenticated;
grant execute on function public._referral_credit(uuid) to service_role;

-- The Refer & earn card reads THIS, not (earned − credited): a balance held by a pending checkout
-- is not spendable, and a card promising more than the checkout will honour is worse than a
-- slightly conservative one.
create or replace function public.my_referral_credit()
returns numeric language sql stable security definer set search_path = public as $$
  select public._referral_credit(public.current_business_id());
$$;
revoke all on function public.my_referral_credit() from public, anon;
grant execute on function public.my_referral_credit() to authenticated;

-- ---------------------------------------------------------------- 3. the quote the customer sees
-- One server-side answer for "what does this cost me": list price, both discounts, credit available
-- and what is actually due. The UI renders this and sends back only a yes/no on using credit — it
-- never sends an amount, so the trust boundary is unchanged.
create or replace function public.my_payment_quote(p_plan_key text, p_cycle text)
returns table (
  amount            numeric,   -- plan price after discounts (what the plan costs)
  currency          text,
  list_amount       numeric,
  cycle_discount    numeric,
  referee_discount  numeric,
  credit_available  numeric,   -- spendable balance right now
  credit_applicable numeric,   -- what would be applied to THIS payment: min(available, amount)
  amount_due        numeric    -- what the provider would be asked for
)
language plpgsql stable security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); q record; v_credit numeric;
begin
  if v_biz is null then return; end if;
  select * into q from public.quote_subscription_price(v_biz, p_plan_key, p_cycle);
  v_credit := public._referral_credit(v_biz);
  return query select
    q.amount, q.currency, q.list_amount, q.cycle_discount, q.referee_discount,
    v_credit, least(v_credit, q.amount), greatest(0, q.amount - least(v_credit, q.amount));
end $$;
revoke all on function public.my_payment_quote(text, text) from public, anon;
grant execute on function public.my_payment_quote(text, text) to authenticated;
grant execute on function public.my_payment_quote(text, text) to service_role;

-- ---------------------------------------------------------------- 4. shared activation body
-- Both entry points (a confirmed provider payment, and a fully-credit payment) apply a plan the
-- same way, so the rules live in ONE place: early renewal of the same plan+cycle extends from the
-- current expiry, paying completes onboarding, credit is debited to the payout ledger, and the
-- money record carries only cash. Called with the billing_payment row already locked.
create or replace function public._apply_paid_subscription(p public.billing_payment)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.businesses
     set subscription_started_at = case
           when subscription_tier = p.plan_key and subscription_cycle = p.cycle
                and subscription_renews_at > now()
           then subscription_renews_at
           else now()
         end,
         subscription_tier    = p.plan_key,
         subscription_cycle   = p.cycle,
         cancel_at_period_end = false   -- paying again cancels any pending move to Free
   where id = p.business_id;

  -- Paying is proof of being set up: with the same-tab checkout redirect the payer may have left
  -- the onboarding wizard mid-flight, and it must not reopen when they return.
  update public.profiles set onboarded = true
   where id = p.created_by and coalesce(onboarded, false) = false;

  -- Credit spent is recorded in the same ledger the CRM writes manual payouts to, so "credit
  -- available" drops by exactly what was used and an admin can see where it went.
  if coalesce(p.credit_applied, 0) > 0 then
    insert into public.cs_referral_payout (business_id, amount, kind, note, created_by)
    values (p.business_id, p.credit_applied, 'subscription',
            format('Referral credit applied to %s (%s) — payment %s', p.plan_key, p.cycle, p.our_reference),
            p.created_by);
  end if;

  -- The money record: CASH ONLY. Credit is not income, so revenue reporting and referral
  -- commission must not see it; the note keeps the full story for CS.
  insert into public.cs_renewal_payment (business_id, paid_at, amount, plan_key, cycle, ref_no, notes)
  values (p.business_id, current_date, coalesce(p.amount_paid, 0), p.plan_key, p.cycle,
          coalesce(p.provider_reference, p.our_reference),
          case
            when coalesce(p.credit_applied, 0) > 0 and coalesce(p.amount_paid, 0) = 0
              then format('Referral credit %s — no cash collected', p.credit_applied)
            when coalesce(p.credit_applied, 0) > 0
              then format('%s %s + referral credit %s',
                          initcap(coalesce(p.provider, 'monnify')),
                          coalesce(p.provider_reference, p.our_reference), p.credit_applied)
            else initcap(coalesce(p.provider, 'monnify')) || ' ' ||
                 coalesce(p.provider_reference, p.our_reference)
          end);
end $$;
revoke all on function public._apply_paid_subscription(public.billing_payment) from public, anon, authenticated;

-- ---------------------------------------------------------------- 5. activation from a provider
-- Full re-declare (from 20260807110000). Changes: the plan/onboarding/money block moved into
-- _apply_paid_subscription so the credit path shares it, and the exact-amount check now compares
-- against the CASH asked for (billing_payment.amount already excludes any credit applied).
create or replace function public.activate_subscription_from_payment(
  p_our_reference text, p_provider_reference text, p_amount_paid numeric, p_raw jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.billing_payment%rowtype;
begin
  select * into p from public.billing_payment where our_reference = p_our_reference for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown payment reference');
  end if;
  if p.status = 'paid' then                      -- already handled; a retry is not an error
    return jsonb_build_object('ok', true, 'idempotent', true, 'business_id', p.business_id);
  end if;
  if p.status = 'mismatch' and p.amount_paid is not distinct from p_amount_paid then
    return jsonb_build_object('ok', true, 'idempotent', true, 'activated', false,
                              'reason', 'amount_mismatch', 'expected', p.amount, 'received', p_amount_paid);
  end if;

  -- Only an EXACT payment activates a plan. Anything else is recorded against the business and
  -- flagged for a human — we never guess what a mismatched amount was meant to buy, and we never
  -- activate a plan the money doesn't cover. The money is still logged so nothing is lost.
  -- Any credit on this intent stays unspent: the ledger row is written on success only.
  if coalesce(p_amount_paid, 0) <> p.amount then
    update public.billing_payment
       set status = 'mismatch', amount_paid = p_amount_paid,
           provider_reference = coalesce(p_provider_reference, provider_reference),
           raw = coalesce(p_raw, raw)
     where id = p.id;
    insert into public.cs_renewal_payment (business_id, paid_at, amount, plan_key, cycle, ref_no, notes)
    values (p.business_id, current_date, p_amount_paid, p.plan_key, p.cycle,
            coalesce(p_provider_reference, p.our_reference),
            format('%s: expected %s, received %s — subscription NOT activated, needs review',
                   initcap(coalesce(p.provider, 'monnify')), p.amount, p_amount_paid));
    return jsonb_build_object('ok', true, 'activated', false, 'reason', 'amount_mismatch',
                              'expected', p.amount, 'received', p_amount_paid);
  end if;

  p.amount_paid        := p_amount_paid;
  p.provider_reference := coalesce(p_provider_reference, p.provider_reference);
  perform public._apply_paid_subscription(p);

  update public.billing_payment
     set status = 'paid', amount_paid = p_amount_paid, paid_at = now(),
         provider_reference = coalesce(p_provider_reference, provider_reference),
         raw = coalesce(p_raw, raw)
   where id = p.id;

  return jsonb_build_object('ok', true, 'activated', true, 'business_id', p.business_id,
                            'plan', p.plan_key, 'cycle', p.cycle,
                            'credit_applied', coalesce(p.credit_applied, 0));
end $$;
revoke all on function public.activate_subscription_from_payment(text, text, numeric, jsonb)
  from public, anon, authenticated;
grant execute on function public.activate_subscription_from_payment(text, text, numeric, jsonb) to service_role;

-- ---------------------------------------------------------------- 6. paying entirely with credit
-- The ONLY path that activates a plan without money arriving, so it is the most security-sensitive
-- function here:
--   * service_role only — the browser cannot reach it; create-payment calls it after checking the
--     caller owns the business.
--   * the price and the balance are both recomputed HERE, under a lock on the business row, so two
--     concurrent calls cannot spend one balance twice.
--   * it refuses unless credit covers the whole price: a short balance must go back through the
--     provider for the remainder, never activate on partial funds.
create or replace function public.activate_subscription_with_credit(
  p_business_id uuid, p_plan_key text, p_cycle text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_price numeric; v_cur text; v_credit numeric; v_ref text; p public.billing_payment%rowtype;
begin
  if p_business_id is null or p_plan_key is null or p_cycle is null then
    return jsonb_build_object('ok', false, 'error', 'business, plan and cycle are required');
  end if;

  -- Serialises concurrent credit spends for this business (the balance is derived, so the row
  -- lock is what makes read-then-write safe).
  perform 1 from public.businesses where id = p_business_id for update;

  select amount, currency into v_price, v_cur
    from public.quote_subscription_price(p_business_id, p_plan_key, p_cycle);
  if v_price is null then
    return jsonb_build_object('ok', false, 'error', 'that plan has no payable price');
  end if;

  v_credit := public._referral_credit(p_business_id);
  if v_credit < v_price then
    return jsonb_build_object('ok', false, 'error', 'not enough referral credit',
                              'price', v_price, 'credit', v_credit);
  end if;

  v_ref := 'ITV-CR-' || left(replace(p_business_id::text, '-', ''), 8) || '-' ||
           to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');

  insert into public.billing_payment
    (business_id, plan_key, cycle, amount, amount_paid, currency, method, provider,
     our_reference, status, credit_applied, created_by, paid_at)
  values
    (p_business_id, p_plan_key, p_cycle, 0, 0, coalesce(v_cur, 'NGN'), 'credit', 'credit',
     v_ref, 'paid', v_price, p_actor, now())
  returning * into p;

  perform public._apply_paid_subscription(p);

  return jsonb_build_object('ok', true, 'activated', true, 'business_id', p_business_id,
                            'plan', p_plan_key, 'cycle', p_cycle,
                            'credit_applied', v_price, 'reference', v_ref);
end $$;
revoke all on function public.activate_subscription_with_credit(uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.activate_subscription_with_credit(uuid, text, text, uuid) to service_role;

-- ---------------------------------------------------------------- 7. history tells the whole story
-- Full re-declare (from 20260810100000). Changes: `amount` is what the plan cost — cash PLUS any
-- credit applied — because cs_renewal_payment.amount is deliberately cash-only, and a fully-credit
-- payment would otherwise read as ₦0 on the customer's own receipt. `credit_applied` rides along so
-- the receipt can show how it was settled instead of implying the whole figure was paid in cash.
-- Return type changes, so the old signature must go first (42P13 otherwise).
drop function if exists public.my_billing_history();
create or replace function public.my_billing_history()
returns table (
  id uuid, paid_at date, plan_key text, cycle text,
  amount numeric, currency text, reference text, method text, credit_applied numeric
)
language plpgsql stable security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id();
begin
  if v_biz is null then return; end if;
  return query
  select rp.id, rp.paid_at, rp.plan_key, rp.cycle,
         coalesce(rp.amount, 0) + coalesce(bp.credit_applied, 0),
         coalesce(rp.currency, 'NGN'),
         coalesce(rp.ref_no, bp.provider_reference, bp.our_reference),
         coalesce(bp.method, 'manual'),
         coalesce(bp.credit_applied, 0)
  from public.cs_renewal_payment rp
  -- Joined on the payment reference the activation stamped into ref_no — a business/day/amount
  -- heuristic fans out when two equal payments land on one day. LATERAL LIMIT 1 so one ref_no
  -- can never fan out across the two reference columns either; our own reference wins any tie.
  left join lateral (
    select b.method, b.status, b.provider_reference, b.our_reference, b.credit_applied
    from public.billing_payment b
    where b.business_id = rp.business_id
      and rp.ref_no is not null
      and (b.provider_reference = rp.ref_no or b.our_reference = rp.ref_no)
    order by (b.our_reference = rp.ref_no) desc
    limit 1
  ) bp on true
  where rp.business_id = v_biz
    and (bp.status is null or bp.status = 'paid')
  order by rp.paid_at desc, rp.created_at desc;
end $$;
revoke all on function public.my_billing_history() from public, anon;
grant execute on function public.my_billing_history() to authenticated;

notify pgrst, 'reload schema';

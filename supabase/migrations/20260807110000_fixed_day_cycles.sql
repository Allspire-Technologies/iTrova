-- Fixed-day billing cycles + paying completes onboarding.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- 1. Cycles were calendar intervals (+1 month = 28–31 days, +1 year = 365–366), so the "renews in
--    N days" figures drifted. Cycles are now fixed day counts: monthly 30, quarterly 90,
--    biannual 180, annual 365. Existing subscriptions keep their current dates — the trigger only
--    fires on future writes, and nobody's already-promised renewal date moves.
-- 2. With the same-tab checkout redirect, a customer who pays during onboarding leaves the wizard
--    mid-flight. Paying is proof of being set up, so activation marks the payer onboarded —
--    server-side, so there's no client race on the return trip.

create or replace function public.set_subscription_renews_at()
returns trigger language plpgsql as $$
begin
  if coalesce(new.subscription_tier, 'free') = 'free' then
    -- Free clears any renewal date.
    new.subscription_renews_at := null;
  elsif new.subscription_started_at is not null and new.subscription_cycle is not null then
    new.subscription_renews_at := new.subscription_started_at + case new.subscription_cycle
        when 'monthly'   then interval '30 days'
        when 'quarterly' then interval '90 days'
        when 'biannual'  then interval '180 days'
        when 'annual'    then interval '365 days'
      end;
  end if;
  -- Paid tier without start/cycle: leave subscription_renews_at as-is (manual override).
  return new;
end; $$;

-- Full re-declare of the activation function (from 20260802110000). Changes in this version:
-- the profiles.onboarded update after the businesses update, and the money-record notes are
-- provider-aware (initcap(provider) instead of hardcoded "Monnify") in both insert paths.
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
  -- A retried mismatch webhook must not log the money twice (a corrected amount may still proceed).
  if p.status = 'mismatch' and p.amount_paid is not distinct from p_amount_paid then
    return jsonb_build_object('ok', true, 'idempotent', true, 'activated', false,
                              'reason', 'amount_mismatch', 'expected', p.amount, 'received', p_amount_paid);
  end if;

  -- Only an EXACT transfer activates a plan. Anything else is recorded against the business and
  -- flagged for a human — we never guess what a mismatched amount was meant to buy, and we never
  -- activate a plan the money doesn't cover. The money is still logged so nothing is lost.
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

  -- Renewing the same plan+cycle EARLY starts the new period when the current one ends, so paying
  -- five days before expiry doesn't cost five days. Everything else (upgrades, lapsed plans) starts
  -- now. The trg_set_subscription_renews_at trigger derives renews_at from this start.
  update public.businesses
     set subscription_started_at = case
           when subscription_tier = p.plan_key and subscription_cycle = p.cycle
                and subscription_renews_at > now()
           then subscription_renews_at
           else now()
         end,
         subscription_tier       = p.plan_key,
         subscription_cycle      = p.cycle,
         cancel_at_period_end    = false   -- paying again cancels any pending move to Free
   where id = p.business_id;

  -- Paying is proof of being set up: with the same-tab checkout redirect the payer may have left
  -- the onboarding wizard mid-flight, and it must not reopen when they return.
  update public.profiles set onboarded = true
   where id = p.created_by and coalesce(onboarded, false) = false;

  -- The money record. This is what Renewals, revenue reporting and referral earnings all read.
  -- ref_no carries the payment reference so billing history can join the two records exactly.
  insert into public.cs_renewal_payment (business_id, paid_at, amount, plan_key, cycle, ref_no, notes)
  values (p.business_id, current_date, p_amount_paid, p.plan_key, p.cycle,
          coalesce(p_provider_reference, p.our_reference),
          initcap(coalesce(p.provider, 'monnify')) || ' ' || coalesce(p_provider_reference, p.our_reference));

  update public.billing_payment
     set status = 'paid', amount_paid = p_amount_paid, paid_at = now(),
         provider_reference = coalesce(p_provider_reference, provider_reference),
         raw = coalesce(p_raw, raw)
   where id = p.id;

  return jsonb_build_object('ok', true, 'activated', true, 'business_id', p.business_id,
                            'plan', p.plan_key, 'cycle', p.cycle);
end $$;
revoke all on function public.activate_subscription_from_payment(text, text, numeric, jsonb)
  from public, anon, authenticated;
-- Only the webhooks (service_role) may activate. Nothing the browser can reach grants a subscription.
grant execute on function public.activate_subscription_from_payment(text, text, numeric, jsonb) to service_role;

notify pgrst, 'reload schema';

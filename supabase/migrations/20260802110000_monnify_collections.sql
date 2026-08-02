-- Subscription collections via Monnify (Phase 1: bank transfer to a reserved account).
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Until now a business "upgraded" by sending a WhatsApp message and waiting for two CRM admins to
-- run the dual-control plan change. This adds a real collection path: the business gets a dedicated
-- virtual account, transfers to it, and Monnify's webhook activates the plan and records the money.
--
-- The dual-control path stays for manual/comped activations. Money actually arriving is its own
-- authorisation, so the automated path does NOT require two admins — a deliberate difference.
--
-- Trust boundary: the browser never says what anything costs. quote_subscription_price() is the only
-- source of an amount, and the Edge Function re-reads it server-side before asking Monnify for a
-- penny. A tampered request cannot buy Enterprise for ₦100.

-- ---------------------------------------------------------------- 1. one referee-discount implementation
-- The same rule was written three times (my_referee_discount for the app, cs_referee_discount for the
-- CRM, and now billing needs it as service_role where neither gate applies). This is the single
-- implementation; the two public wrappers below just add their own authorisation.
create or replace function public._referee_discount(p_business_id uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_code text; v_cycle text; v_pct numeric; v_valid boolean;
begin
  select nullif(upper(trim(referred_by_code)), ''), subscription_cycle
    into v_code, v_cycle from public.businesses where id = p_business_id;
  if v_code is null then return 0; end if;
  if v_cycle is not null then return 0; end if;   -- first payment already taken
  select exists (select 1 from public.cs_referrer cr where upper(cr.code) = v_code and cr.active)
      or exists (select 1 from public.businesses b
                  where upper(b.referral_code) = v_code and b.id <> p_business_id)
    into v_valid;
  if not v_valid then return 0; end if;
  select referee_discount_percent into v_pct from public.referral_config limit 1;
  return coalesce(v_pct, 0);
end $$;
revoke all on function public._referee_discount(uuid) from public, anon, authenticated;

create or replace function public.my_referee_discount()
returns numeric language sql stable security definer set search_path = public as $$
  select public._referee_discount(public.current_business_id());
$$;
revoke all on function public.my_referee_discount() from public, anon;
grant execute on function public.my_referee_discount() to authenticated;

-- ---------------------------------------------------------------- 2. what a plan actually costs
-- Cycle list price less its standing discount, then the referred-business first-payment discount.
create or replace function public.quote_subscription_price(
  p_business_id uuid, p_plan_key text, p_cycle text
) returns table (amount numeric, currency text, list_amount numeric, cycle_discount numeric, referee_discount numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_caller uuid := public.current_business_id(); v_list numeric; v_cdisc numeric; v_cur text; v_ref numeric;
begin
  -- A signed-in user may only price their own business. service_role (no business context) may price any.
  if v_caller is not null and v_caller <> p_business_id then
    raise exception 'not authorised for this business' using errcode = '42501';
  end if;
  select pp.price_amount, coalesce(pp.discount_percent, 0), coalesce(pl.price_currency, 'NGN')
    into v_list, v_cdisc, v_cur
    from public.plan_prices pp
    join public.plans pl on pl.id = pp.plan_id
   where pl.key = p_plan_key and pp.cycle = p_cycle
   limit 1;
  if v_list is null then
    raise exception 'no % plan on a % cycle', p_plan_key, p_cycle using errcode = 'no_data_found';
  end if;
  v_ref := public._referee_discount(p_business_id);
  return query select
    round(round(v_list * (1 - v_cdisc / 100.0)) * (1 - v_ref / 100.0)),
    v_cur, v_list, v_cdisc, v_ref;
end $$;
revoke all on function public.quote_subscription_price(uuid, text, text) from public, anon;
grant execute on function public.quote_subscription_price(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 3. no permanent virtual accounts
-- An earlier draft gave each business a permanent reserved account. That account accepts ANY amount
-- from anyone, forever, so the wrong figure could arrive and we'd be rejecting money after the fact.
-- Every payment now goes through Monnify's init-transaction, which binds the amount to that one
-- transaction and issues a one-time account for exactly it — Monnify enforces the amount, we don't
-- have to. Dropped here so a project that ran the earlier draft doesn't keep a live any-amount account.
drop table if exists public.business_reserved_account;

-- ---------------------------------------------------------------- 4. payment intents/attempts
create table if not exists public.billing_payment (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses(id) on delete cascade,
  plan_key           text not null,
  cycle              text not null,
  amount             numeric not null check (amount >= 0),   -- what we asked for
  amount_paid        numeric,                                -- what actually arrived
  currency           text not null default 'NGN',
  method             text not null default 'transfer' check (method in ('transfer', 'card')),
  provider           text not null default 'monnify',
  our_reference      text not null unique,                   -- paymentReference we generate
  provider_reference text unique,                            -- Monnify's transactionReference
  status             text not null default 'pending'
                       check (status in ('pending', 'paid', 'mismatch', 'failed', 'abandoned')),
  raw                jsonb,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);
create index if not exists billing_payment_business_idx on public.billing_payment (business_id, created_at desc);
create index if not exists billing_payment_pending_idx on public.billing_payment (business_id) where status = 'pending';

alter table public.billing_payment enable row level security;
revoke all on public.billing_payment from anon;
grant select on public.billing_payment to authenticated;
-- Read-only to the app: rows are created by the Edge Function so the amount is never client-supplied.
drop policy if exists "own billing payments" on public.billing_payment;
create policy "own billing payments" on public.billing_payment
  for select to authenticated using (business_id = public.current_business_id());

-- ---------------------------------------------------------------- 4b. downgrading to Free
-- A downgrade takes effect at the END of the paid period: the customer keeps what they paid for,
-- nothing is refunded, and there is no cash to claw back from an irreversible bank transfer. A
-- subscription already lapses at subscription_renews_at, so this is really "don't renew" — the flag
-- records the intent so the UI can show it and (Phase 3) renewal reminders can skip them.
alter table public.businesses add column if not exists cancel_at_period_end boolean not null default false;
comment on column public.businesses.cancel_at_period_end is
  'Owner asked to move to Free. They keep the paid plan until subscription_renews_at, then lapse. '
  'Cleared automatically whenever a new payment is activated.';

create or replace function public.set_subscription_cancel(p_cancel boolean)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id();
begin
  if v_biz is null then raise exception 'no business' using errcode = 'no_data_found'; end if;
  -- Billing is the owner's call, not a manager's.
  if not public.has_business_role(v_biz, auth.uid(), 'owner') then
    raise exception 'only the owner can change the subscription' using errcode = '42501';
  end if;
  update public.businesses set cancel_at_period_end = coalesce(p_cancel, false) where id = v_biz;
  return coalesce(p_cancel, false);
end $$;
revoke all on function public.set_subscription_cancel(boolean) from public, anon;
grant execute on function public.set_subscription_cancel(boolean) to authenticated;

-- ---------------------------------------------------------------- 5. activation from a confirmed payment
-- service_role only: the webhook calls this AFTER verifying Monnify's signature and re-confirming the
-- transaction against Monnify's API. Idempotent — Monnify retries webhooks, and a repeat must not
-- activate twice or double-count the money (which would inflate referral commission).
create or replace function public.activate_subscription_from_payment(
  p_our_reference text, p_provider_reference text, p_amount_paid numeric, p_raw jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p public.billing_payment%rowtype; v_months int;
begin
  select * into p from public.billing_payment where our_reference = p_our_reference for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown payment reference');
  end if;
  if p.status = 'paid' then                      -- already handled; a retry is not an error
    return jsonb_build_object('ok', true, 'idempotent', true, 'business_id', p.business_id);
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
    insert into public.cs_renewal_payment (business_id, paid_at, amount, plan_key, cycle, notes)
    values (p.business_id, current_date, p_amount_paid, p.plan_key, p.cycle,
            format('Monnify: expected %s, received %s — subscription NOT activated, needs review',
                   p.amount, p_amount_paid));
    return jsonb_build_object('ok', true, 'activated', false, 'reason', 'amount_mismatch',
                              'expected', p.amount, 'received', p_amount_paid);
  end if;

  update public.businesses
     set subscription_tier       = p.plan_key,
         subscription_cycle      = p.cycle,
         subscription_started_at = now(),
         cancel_at_period_end    = false   -- paying again cancels any pending move to Free
   where id = p.business_id;

  -- The money record. This is what Renewals, revenue reporting and referral earnings all read.
  insert into public.cs_renewal_payment (business_id, paid_at, amount, plan_key, cycle, notes)
  values (p.business_id, current_date, p_amount_paid, p.plan_key, p.cycle,
          'Monnify ' || coalesce(p_provider_reference, p.our_reference));

  update public.billing_payment
     set status = 'paid', amount_paid = p_amount_paid, paid_at = now(),
         provider_reference = coalesce(p_provider_reference, provider_reference),
         raw = coalesce(p_raw, raw)
   where id = p.id;

  select count(*) into v_months from public.billing_payment where business_id = p.business_id and status = 'paid';
  return jsonb_build_object('ok', true, 'activated', true, 'business_id', p.business_id,
                            'plan', p.plan_key, 'cycle', p.cycle);
end $$;
revoke all on function public.activate_subscription_from_payment(text, text, numeric, jsonb)
  from public, anon, authenticated;
-- Only the webhook (service_role) may activate. Nothing the browser can reach grants a subscription.
grant execute on function public.activate_subscription_from_payment(text, text, numeric, jsonb) to service_role;

-- ---------------------------------------------------------------- 6. billing history for the business
-- Reads cs_renewal_payment — the money record every payment lands in, whether it came through
-- Monnify here or was recorded by an admin in the CRM. billing_payment alone would show only
-- self-serve payments, so a business activated manually would see an empty history.
-- cs_renewal_payment is CRM/staff-only at the RLS layer, hence SECURITY DEFINER scoped to the
-- caller's own business.
create or replace function public.my_billing_history()
returns table (
  id uuid, paid_at date, plan_key text, cycle text,
  amount numeric, currency text, reference text, method text
)
language plpgsql stable security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id();
begin
  if v_biz is null then return; end if;
  return query
  select rp.id, rp.paid_at, rp.plan_key, rp.cycle,
         coalesce(rp.amount, 0), coalesce(rp.currency, 'NGN'),
         coalesce(rp.ref_no, bp.provider_reference, bp.our_reference),
         coalesce(bp.method, 'manual')
  from public.cs_renewal_payment rp
  -- Same business, same day, same amount ⇒ the self-serve payment that produced this record.
  left join public.billing_payment bp
    on bp.business_id = rp.business_id and bp.status = 'paid'
   and bp.amount = rp.amount and bp.paid_at::date = rp.paid_at
  where rp.business_id = v_biz
  order by rp.paid_at desc, rp.created_at desc;
end $$;
revoke all on function public.my_billing_history() from public, anon;
grant execute on function public.my_billing_history() to authenticated;

notify pgrst, 'reload schema';

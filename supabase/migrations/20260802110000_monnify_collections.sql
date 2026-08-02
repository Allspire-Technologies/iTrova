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

-- ---------------------------------------------------------------- 3. the reserved (virtual) account
-- Monnify issues one permanent account per business; created on first use and reused thereafter.
create table if not exists public.business_reserved_account (
  business_id       uuid primary key references public.businesses(id) on delete cascade,
  account_reference text not null unique,       -- our reference, sent to Monnify
  account_name      text,
  accounts          jsonb not null default '[]'::jsonb,  -- Monnify returns one row per bank
  provider          text not null default 'monnify',
  created_at        timestamptz not null default now()
);
alter table public.business_reserved_account enable row level security;
revoke all on public.business_reserved_account from anon;
grant select on public.business_reserved_account to authenticated;
drop policy if exists "own reserved account" on public.business_reserved_account;
create policy "own reserved account" on public.business_reserved_account
  for select to authenticated using (business_id = public.current_business_id());

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
                       check (status in ('pending', 'paid', 'underpaid', 'failed', 'abandoned')),
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

  -- Short payment: keep the money against the business and tell them, rather than silently
  -- activating a plan they haven't covered or bouncing a transfer they've already sent.
  if coalesce(p_amount_paid, 0) < p.amount then
    update public.billing_payment
       set status = 'underpaid', amount_paid = p_amount_paid,
           provider_reference = coalesce(p_provider_reference, provider_reference),
           raw = coalesce(p_raw, raw)
     where id = p.id;
    insert into public.cs_renewal_payment (business_id, paid_at, amount, plan_key, cycle, notes)
    values (p.business_id, current_date, p_amount_paid, p.plan_key, p.cycle,
            'Monnify: part payment, subscription not activated');
    return jsonb_build_object('ok', true, 'activated', false, 'reason', 'underpaid',
                              'expected', p.amount, 'received', p_amount_paid);
  end if;

  update public.businesses
     set subscription_tier       = p.plan_key,
         subscription_cycle      = p.cycle,
         subscription_started_at = now()
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

notify pgrst, 'reload schema';

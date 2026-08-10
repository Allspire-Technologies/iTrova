-- Payment hardening from the #172 (go-live) review round.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).

-- ---------------------------------------------------------------- 1. clamp discount inputs
-- Full re-declare from 20260802110000; only the clamps change. A discount outside 0–100
-- (bad CRM write, referral misconfig) must never produce a negative or inflated price.
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
  v_cdisc := least(greatest(v_cdisc, 0), 100);
  v_ref   := least(greatest(public._referee_discount(p_business_id), 0), 100);
  return query select
    round(round(v_list * (1 - v_cdisc / 100.0)) * (1 - v_ref / 100.0)),
    v_cur, v_list, v_cdisc, v_ref;
end $$;
revoke all on function public.quote_subscription_price(uuid, text, text) from public, anon;
grant execute on function public.quote_subscription_price(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 2. mismatches are not invoices
-- Full re-declare from 20260802110000. A mismatched payment's money record exists for CS review,
-- but it must not render in the customer's billing history as a normal invoice — the plan was
-- NOT activated. Excluded by joining the payment row on the same reference the activation
-- stamped into ref_no; manual CRM rows (no billing_payment match) still show.
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
  -- Joined on the payment reference the activation stamped into ref_no — a business/day/amount
  -- heuristic fans out when two equal payments land on one day.
  left join public.billing_payment bp
    on bp.business_id = rp.business_id
   and rp.ref_no is not null
   and (bp.provider_reference = rp.ref_no or bp.our_reference = rp.ref_no)
  where rp.business_id = v_biz
    and (bp.status is null or bp.status = 'paid')
  order by rp.paid_at desc, rp.created_at desc;
end $$;
revoke all on function public.my_billing_history() from public, anon;
grant execute on function public.my_billing_history() to authenticated;

-- ---------------------------------------------------------------- 3. renewal trigger hardening
-- Full re-declare from 20260807110000: an unknown cycle value (bad CRM write) must not null a
-- paid tier's renewal date — fall back to 30 days so the customer keeps a date and CS sees a
-- wrong-looking one instead of none. search_path pinned like every other definer/trigger function.
create or replace function public.set_subscription_renews_at()
returns trigger language plpgsql set search_path = public as $$
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
        else interval '30 days'
      end;
  end if;
  -- Paid tier without start/cycle: leave subscription_renews_at as-is (manual override).
  return new;
end; $$;

-- ---------------------------------------------------------------- 4. billing_config.updated_at
drop trigger if exists billing_config_set_updated_at on public.billing_config;
create trigger billing_config_set_updated_at
  before update on public.billing_config
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';

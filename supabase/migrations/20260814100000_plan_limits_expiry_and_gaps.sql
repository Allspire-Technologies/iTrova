-- Plan limits: honour expiry, and close the two tables the caps never reached.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- 20260726100000 moved the caps into the database so the REST API couldn't be used to walk past
-- them. Two gaps remained:
--
-- 1. EXPIRY NEVER REACHED THE DATABASE. The app treats a lapsed paid plan as Free (AuthContext
--    rewrites subscription_tier once subscription_renews_at has passed, so every downstream check
--    — limits, modules, plan resolution — sees "free"). _plan_cap read businesses.subscription_tier
--    raw, which still says 'pro'. So the UI applied Free caps while the database applied Pro's,
--    disagreeing exactly when enforcement matters. The tier now resolves the same way in both.
--
-- 2. raw_materials and purchase_orders were capped in the UI only — the very bypass the earlier
--    migration existed to close, left open on two tables.
--
-- Unchanged on purpose: hitting a cap only blocks NEW rows. Everything a business already has stays
-- readable and editable, including records created while they were on a bigger plan. Losing access
-- to your own data because a card expired is not a limit, it's a hostage situation.

-- ---------------------------------------------------------------- 1. the tier to actually apply
-- Mirrors src/lib/subscription.ts effectiveTier + the AuthContext coercion: a paid tier whose
-- renewal date has passed is Free. No renewal date = nothing to expire (manual/comped grants and
-- Free itself). Keep this in step with the client — two answers to "what plan is this?" is the bug
-- this migration exists to fix.
create or replace function public._effective_tier(_business_id uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(b.subscription_tier, 'free') = 'free'      then 'free'
    when b.subscription_renews_at is null                    then b.subscription_tier
    when b.subscription_renews_at <= now()                   then 'free'
    else b.subscription_tier
  end
  from public.businesses b where b.id = _business_id;
$$;
revoke all on function public._effective_tier(uuid) from public, anon;
grant execute on function public._effective_tier(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- 2. caps read the effective tier
-- Full re-declare from 20260726100000; only the tier lookup changes.
create or replace function public._plan_cap(_business_id uuid, _module text, _legacy text)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_tier   text;
  v_limits jsonb;
  v_val    jsonb;
begin
  v_tier := public._effective_tier(_business_id);   -- lapsed paid plans resolve to 'free'
  select limits into v_limits from public.plans where key = coalesce(v_tier, 'free') and is_active;
  if v_limits is null then
    -- Unknown tier / inactive plan row → fall back to the Free plan's caps (enforcement-safe).
    select limits into v_limits from public.plans where key = 'free' and is_active;
  end if;
  if v_limits is null then return null; end if;
  v_val := coalesce(v_limits -> _module, v_limits -> _legacy);
  if v_val is null or jsonb_typeof(v_val) = 'null' then return null; end if;
  return (v_val #>> '{}')::numeric;
exception when others then
  return null; -- a malformed limits value must never block writes
end; $$;

-- ---------------------------------------------------------------- 3. the two missing tables
-- Full re-declare from 20260726100000; adds raw_materials and purchase_orders to the case. The
-- legacy keys are the camelCase resource names the client falls back to (src/lib/planLimits.ts
-- RESOURCE_MODULE), so a plan keyed either way resolves identically in both layers.
create or replace function public.trg_enforce_plan_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cap   numeric;
  v_count bigint;
begin
  -- Manual invoices only — POS-generated invoices (sale_id set) are never blocked at the till.
  if TG_TABLE_NAME = 'invoices' and NEW.sale_id is not null then return NEW; end if;

  v_cap := case TG_TABLE_NAME
    when 'products'        then public._plan_cap(NEW.business_id, 'inventory',       'products')
    when 'suppliers'       then public._plan_cap(NEW.business_id, 'suppliers',       'suppliers')
    when 'invoices'        then public._plan_cap(NEW.business_id, 'invoices',        'invoices')
    when 'invitations'     then public._plan_cap(NEW.business_id, 'team',            'staff')
    when 'raw_materials'   then public._plan_cap(NEW.business_id, 'raw_materials',   'rawMaterials')
    when 'purchase_orders' then public._plan_cap(NEW.business_id, 'purchase_orders', 'purchaseOrders')
  end;
  if v_cap is null then return NEW; end if;

  if TG_TABLE_NAME = 'invitations' then
    -- Staff = current members plus unexpired invitations still waiting to be accepted.
    select (select count(*) from public.user_roles where business_id = NEW.business_id)
         + (select count(*) from public.invitations where business_id = NEW.business_id and accepted_at is null and expires_at > now())
      into v_count;
  elsif TG_TABLE_NAME = 'invoices' then
    select count(*) into v_count from public.invoices where business_id = NEW.business_id and sale_id is null;
  else
    execute format('select count(*) from public.%I where business_id = $1', TG_TABLE_NAME)
      into v_count using NEW.business_id;
  end if;

  if v_count >= v_cap then
    raise exception 'PLAN_LIMIT: your plan allows % % — upgrade to add more',
      v_cap::int, case TG_TABLE_NAME when 'invitations' then 'team members'
                                     when 'invoices' then 'manual invoices'
                                     when 'raw_materials' then 'raw materials'
                                     when 'purchase_orders' then 'purchase orders'
                                     else TG_TABLE_NAME end
      using errcode = 'check_violation';
  end if;
  return NEW;
end; $$;

drop trigger if exists enforce_plan_limit_raw_materials on public.raw_materials;
create trigger enforce_plan_limit_raw_materials before insert on public.raw_materials
  for each row execute function public.trg_enforce_plan_limit();

drop trigger if exists enforce_plan_limit_purchase_orders on public.purchase_orders;
create trigger enforce_plan_limit_purchase_orders before insert on public.purchase_orders
  for each row execute function public.trg_enforce_plan_limit();

-- ---------------------------------------------------------------- 4. what the app should ask
-- The UI counts and the database counts must agree, or a business sees room it doesn't have.
-- Team is the one that differed: the trigger counts members PLUS pending invitations, the Team
-- page counted members only. This function is the single answer, so the page can stop guessing.
create or replace function public.my_plan_usage()
returns table (resource text, used bigint, cap numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id();
begin
  if v_biz is null then return; end if;
  return query
  select 'products'::text, (select count(*) from public.products where business_id = v_biz),
         public._plan_cap(v_biz, 'inventory', 'products')
  union all
  select 'suppliers', (select count(*) from public.suppliers where business_id = v_biz),
         public._plan_cap(v_biz, 'suppliers', 'suppliers')
  union all
  select 'invoices', (select count(*) from public.invoices where business_id = v_biz and sale_id is null),
         public._plan_cap(v_biz, 'invoices', 'invoices')
  union all
  select 'rawMaterials', (select count(*) from public.raw_materials where business_id = v_biz),
         public._plan_cap(v_biz, 'raw_materials', 'rawMaterials')
  union all
  select 'purchaseOrders', (select count(*) from public.purchase_orders where business_id = v_biz),
         public._plan_cap(v_biz, 'purchase_orders', 'purchaseOrders')
  union all
  -- Matches the trigger exactly: seats in use = members + invitations still awaiting acceptance.
  select 'staff',
         (select count(*) from public.user_roles where business_id = v_biz)
       + (select count(*) from public.invitations
           where business_id = v_biz and accepted_at is null and expires_at > now()),
         public._plan_cap(v_biz, 'team', 'staff');
end $$;
revoke all on function public.my_plan_usage() from public, anon;
grant execute on function public.my_plan_usage() to authenticated;

notify pgrst, 'reload schema';

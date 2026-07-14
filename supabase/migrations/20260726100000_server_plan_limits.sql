-- Server-side plan limits (Experience roadmap F9 / Phase 7).
-- The plan caps in plans.limits were enforced only in the UI (isAtLimit in src/lib/planLimits.ts)
-- — anyone calling the REST API directly could bypass the Free tier's 25 products / 50 invoices /
-- 3 staff. These BEFORE INSERT triggers enforce the same caps in the database.
--
-- Resolution mirrors the client exactly: businesses.subscription_tier = plans.key; plans.limits is
-- jsonb keyed by MODULE name ("inventory", "team", …) with the legacy resource key ("products", …)
-- as fallback; a jsonb null or a missing key = unlimited. An unknown tier (or missing plan row)
-- falls back to the Free plan's caps — same "enforcement is safe by default" rule as the client.
--
-- Deliberate scope:
--   • products, suppliers, invitations (staff) — capped on insert.
--   • invoices — capped ONLY for manual invoices (sale_id is null). POS sales create invoices
--     inside commit_offline_sale; a hard cap there would stop a shop mid-sale at the till.
--   • Updates/deletes are never blocked; hitting the cap only stops NEW rows.

-- The cap for one module/resource on a business's plan: numeric, or null = unlimited.
create or replace function public._plan_cap(_business_id uuid, _module text, _legacy text)
returns numeric
language plpgsql stable security definer set search_path = public as $$
declare
  v_tier   text;
  v_limits jsonb;
  v_val    jsonb;
begin
  select subscription_tier into v_tier from public.businesses where id = _business_id;
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
    when 'products'    then public._plan_cap(NEW.business_id, 'inventory', 'products')
    when 'suppliers'   then public._plan_cap(NEW.business_id, 'suppliers', 'suppliers')
    when 'invoices'    then public._plan_cap(NEW.business_id, 'invoices',  'invoices')
    when 'invitations' then public._plan_cap(NEW.business_id, 'team',      'staff')
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
                                     else TG_TABLE_NAME end
      using errcode = 'check_violation';
  end if;
  return NEW;
end; $$;

drop trigger if exists enforce_plan_limit_products on public.products;
create trigger enforce_plan_limit_products before insert on public.products
  for each row execute function public.trg_enforce_plan_limit();

drop trigger if exists enforce_plan_limit_suppliers on public.suppliers;
create trigger enforce_plan_limit_suppliers before insert on public.suppliers
  for each row execute function public.trg_enforce_plan_limit();

drop trigger if exists enforce_plan_limit_invoices on public.invoices;
create trigger enforce_plan_limit_invoices before insert on public.invoices
  for each row execute function public.trg_enforce_plan_limit();

drop trigger if exists enforce_plan_limit_invitations on public.invitations;
create trigger enforce_plan_limit_invitations before insert on public.invitations
  for each row execute function public.trg_enforce_plan_limit();

notify pgrst, 'reload schema';

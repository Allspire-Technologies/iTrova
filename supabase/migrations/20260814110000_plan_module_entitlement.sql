-- Module entitlement, enforced by the database.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- plans.modules decides which modules a plan includes, but it was checked only in the browser
-- (canAccessModule in src/lib/moduleAccess.ts). RLS checks business membership and RBAC checks the
-- caller's ROLE — neither knows anything about the plan. So a Free business could POST straight to
-- /rest/v1/production_runs (or suppliers, assets, expenditure…) and the database accepted it: the
-- UI hid the page, nothing stopped the API.
--
-- Same rules as the caps in 20260814100000: the tier resolves through _effective_tier, so a lapsed
-- paid plan is Free here too, and only NEW rows are refused. A business that downgrades keeps every
-- record it already created and can still read and edit them.
--
-- SCOPE — deliberately narrow, and the exclusions matter more than the inclusions:
--   • Gated: the user-facing entry point of each module that is NOT in every plan.
--   • NOT gated: products, sales, invoices, invitations — every plan includes inventory, pos,
--     invoices and team, so a trigger there is pure risk with no effect.
--   • NOT gated: journal_entries, journal_lines, accounts. These are written by SYSTEM triggers on
--     behalf of businesses on every plan — creating an invoice auto-posts to the ledger
--     (sync_invoice_journal_trg, 20260718100000), as do purchase orders, expenses and assets. Only
--     Enterprise includes the accounting module, so gating the ledger would make every Free, Pro
--     and Business invoice fail. The accounting MODULE gates the reports and the manual
--     post_journal path in the app; the ledger itself must stay writable for everyone.
--
-- Expect this to start refusing new suppliers / raw materials / purchase orders for any business
-- still on Free that has such records from when the Free plan included those modules. That is the
-- point of the change, and their existing data is untouched.

-- ---------------------------------------------------------------- does this plan include it?
-- Opt-in, matching the client exactly: a plan row listing NO modules grants everything, so the two
-- layers agree on a misconfigured plan instead of one silently blocking what the other allows.
create or replace function public._plan_has_module(_business_id uuid, _module text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_tier text; v_modules jsonb;
begin
  v_tier := public._effective_tier(_business_id);
  select modules into v_modules from public.plans where key = coalesce(v_tier, 'free') and is_active;
  if v_modules is null then
    select modules into v_modules from public.plans where key = 'free' and is_active;
  end if;
  if v_modules is null or jsonb_typeof(v_modules) <> 'array' or jsonb_array_length(v_modules) = 0 then
    return true;
  end if;
  return v_modules ? _module;
exception when others then
  return true;   -- malformed plan config must never block writes
end $$;
revoke all on function public._plan_has_module(uuid, text) from public, anon;
grant execute on function public._plan_has_module(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- the gate
create or replace function public.trg_enforce_plan_module()
returns trigger
language plpgsql security definer set search_path = public as $$
declare v_module text; v_label text;
begin
  case TG_TABLE_NAME
    when 'suppliers'                then v_module := 'suppliers';        v_label := 'Suppliers';
    when 'raw_materials'            then v_module := 'raw_materials';    v_label := 'Raw materials';
    when 'purchase_orders'          then v_module := 'purchase_orders';  v_label := 'Purchase orders';
    when 'store_items'              then v_module := 'general_store';    v_label := 'General Store';
    when 'store_transactions'       then v_module := 'general_store';    v_label := 'General Store';
    when 'production_runs'          then v_module := 'production';       v_label := 'Production';
    when 'production_requisitions'  then v_module := 'production';       v_label := 'Production';
    when 'expenses'                 then v_module := 'expenditure';      v_label := 'Expenditure';
    when 'fixed_assets'             then v_module := 'assets';           v_label := 'Assets';
    when 'export_invoices'          then v_module := 'export_invoices';  v_label := 'Export Invoices';
    else return NEW;
  end case;

  if public._plan_has_module(NEW.business_id, v_module) then return NEW; end if;

  raise exception 'PLAN_MODULE: % is not included in your plan — upgrade to use it', v_label
    using errcode = 'check_violation';
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'suppliers', 'raw_materials', 'purchase_orders',
    'store_items', 'store_transactions',
    'production_runs', 'production_requisitions',
    'expenses', 'fixed_assets', 'export_invoices'
  ] loop
    -- Skip anything not present (an environment without that feature's migrations).
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists enforce_plan_module_%1$s on public.%1$I', t);
      execute format(
        'create trigger enforce_plan_module_%1$s before insert on public.%1$I
           for each row execute function public.trg_enforce_plan_module()', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- what the app can ask
-- The modules this business actually has, straight from the backend, so the UI never needs its own
-- copy of the list (it kept one, and it went stale).
create or replace function public.my_plan_modules()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_biz uuid := public.current_business_id(); v_tier text; v_modules jsonb;
begin
  if v_biz is null then return '[]'::jsonb; end if;
  v_tier := public._effective_tier(v_biz);
  select modules into v_modules from public.plans where key = coalesce(v_tier, 'free') and is_active;
  return coalesce(v_modules, '[]'::jsonb);
end $$;
revoke all on function public.my_plan_modules() from public, anon;
grant execute on function public.my_plan_modules() to authenticated;

notify pgrst, 'reload schema';

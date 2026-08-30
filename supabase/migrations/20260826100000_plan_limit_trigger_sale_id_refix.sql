-- Hotfix: adding a product (or supplier / invitation / raw material / purchase order) failed with
--   record "new" has no field "sale_id"
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu) — and to staging.
--
-- A REGRESSION of the bug 20260726110000 fixed. That hotfix nested the invoices guard because SQL
-- does not guarantee short-circuit evaluation: `TG_TABLE_NAME = 'invoices' and NEW.sale_id is not
-- null` can evaluate NEW.sale_id on tables that have no such column. 20260814100000 then
-- re-declared this function (to add fixed-day-expiry tiers and the two new capped tables) and
-- rewrote the guard FLAT again, undoing the July fix.
--
-- Same cure, restated as a rule for the next re-declare: in a trigger function shared by many
-- tables, a table-specific NEW field may only ever appear inside a block that TG_TABLE_NAME
-- alone decides to enter. Never in a compound boolean expression.
--
-- Body otherwise identical to 20260814100000 (effective-tier caps, staff = members + pending
-- invites, manual-invoices-only count, raw materials + purchase orders).

create or replace function public.trg_enforce_plan_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cap   numeric;
  v_count bigint;
begin
  -- Manual invoices only — POS-generated invoices (sale_id set) are never blocked at the till.
  -- NESTED on purpose: NEW.sale_id must not appear in any expression other tables evaluate
  -- (see header; this exact guard has now broken production twice when flattened).
  if TG_TABLE_NAME = 'invoices' then
    if NEW.sale_id is not null then return NEW; end if;
  end if;

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

notify pgrst, 'reload schema';

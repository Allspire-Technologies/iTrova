-- Hotfix for 20260726100000_server_plan_limits: adding a product failed with
--   record "new" has no field "sale_id"
-- The trigger guarded the invoices case with a single expression
--   (TG_TABLE_NAME = 'invoices' and NEW.sale_id is not null)
-- but SQL does not guarantee short-circuit evaluation order, so NEW.sale_id could be
-- evaluated on tables that have no such column (products / suppliers / invitations).
-- Nest the check so the field access only ever runs for invoices.

create or replace function public.trg_enforce_plan_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cap   numeric;
  v_count bigint;
begin
  -- Manual invoices only — POS-generated invoices (sale_id set) are never blocked at the till.
  -- Nested if: NEW.sale_id must not appear in an expression evaluated for other tables.
  if TG_TABLE_NAME = 'invoices' then
    if NEW.sale_id is not null then return NEW; end if;
  end if;

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

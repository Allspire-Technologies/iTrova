-- Fix: next_invoice_number threw "column reference \"period\" is ambiguous" at runtime —
-- the PL/pgSQL variable `period` collided with the doc_counters.period column, so every
-- call errored and the app silently fell back to a timestamp number. Rename the variable
-- to v_period. (create or replace, so it just overwrites the broken definition.)
create or replace function public.next_invoice_number(_business_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  biz_tz text;
  v_period text;
  n integer;
begin
  if _business_id is null or _business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  select coalesce(timezone, 'Africa/Lagos') into biz_tz from public.businesses where id = _business_id;
  v_period := to_char((now() at time zone biz_tz)::date, 'YYMMDD');

  insert into public.doc_counters (business_id, scope, period, seq)
  values (_business_id, 'invoice', v_period, 1)
  on conflict (business_id, scope, period)
  do update set seq = doc_counters.seq + 1
  returning seq into n;

  return v_period || '-' || n::text;
end;
$$;

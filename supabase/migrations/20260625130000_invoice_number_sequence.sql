-- Invoice numbers move to YYMMDD-N: the creation date, then a sequence that starts at 1
-- each new day and counts up within that day, per business (e.g. 260625-1, 260625-2, then
-- 260626-1 the next day). No leading zeros.
--
-- They're also collision-proof. The old next_doc_number used MAX(...)+1, a read-then-write
-- race that could hand the same number to two concurrent inserts and trip the unique
-- constraint. This uses an atomic per-(business, day) counter: INSERT ... ON CONFLICT DO
-- UPDATE takes a row lock, so concurrent callers serialise and each gets a distinct value.
create table if not exists public.doc_counters (
  business_id uuid not null references public.businesses(id) on delete cascade,
  scope text not null,
  period text not null,           -- YYMMDD bucket; the sequence resets when this changes
  seq integer not null default 0,
  primary key (business_id, scope, period)
);

alter table public.doc_counters enable row level security;
-- No policies: rows are written only by the SECURITY DEFINER function below.
grant select on public.doc_counters to authenticated;

create or replace function public.next_invoice_number(_business_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  biz_tz text;
  period text;
  n integer;
begin
  if _business_id is null or _business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  select coalesce(timezone, 'Africa/Lagos') into biz_tz from public.businesses where id = _business_id;
  period := to_char((now() at time zone biz_tz)::date, 'YYMMDD');

  insert into public.doc_counters (business_id, scope, period, seq)
  values (_business_id, 'invoice', period, 1)
  on conflict (business_id, scope, period)
  do update set seq = doc_counters.seq + 1
  returning seq into n;

  return period || '-' || n::text;
end;
$$;

grant execute on function public.next_invoice_number(uuid) to authenticated;

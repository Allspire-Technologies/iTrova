-- Fix: "duplicate key value violates unique constraint invoices_business_id_invoice_number_key".
--
-- Two paths create invoices, but only one was collision-proof:
--   * Manual invoices (Invoices page) -> next_invoice_number() -> atomic per-day counter. Safe.
--   * Auto invoices from a sale (POS) -> trigger create_invoice_from_sale() -> next_doc_number(),
--     which still used MAX(...)+1. That read-then-write races: two quick sales both read the same
--     MAX and insert the same 'INV-000N', tripping the unique constraint.
--
-- Make BOTH numbering functions atomic AND self-healing via the existing doc_counters table:
--   - atomic: INSERT ... ON CONFLICT DO UPDATE takes a row lock, so concurrent callers serialise
--     and each gets a distinct value (no MAX+1 race).
--   - self-healing: seed/reconcile the counter from the highest number already present, so it can
--     never re-issue a value that exists (covers first-call, manual edits, imports, or any drift).

-- ---------------------------------------------------------------------------
-- 1. next_doc_number — used by the sales -> invoice trigger ('INV-000N', running per business).
-- ---------------------------------------------------------------------------
create or replace function public.next_doc_number(_business_id uuid, _prefix text, _table text, _col text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_max int;
  next_n int;
begin
  -- Highest existing number for this prefix in the target table.
  execute format(
    'select coalesce(max(nullif(regexp_replace(%I, ''^%s-'', ''''), '''')::int), 0)
       from public.%I where business_id = $1 and %I like $2',
    _col, _prefix, _table, _col
  ) into existing_max using _business_id, _prefix || '-%';

  -- Atomic per-(business, prefix) running counter. '-' is a constant period (these numbers don't
  -- reset by day). The row lock from ON CONFLICT DO UPDATE serialises concurrent callers.
  insert into public.doc_counters (business_id, scope, period, seq)
  values (_business_id, _prefix, '-', existing_max + 1)
  on conflict (business_id, scope, period)
  do update set seq = greatest(doc_counters.seq, existing_max) + 1
  returning seq into next_n;

  return _prefix || '-' || lpad(next_n::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. next_invoice_number — manual invoices ('YYMMDD-N', resets each day). Already atomic; add the
--    same self-healing reconcile so it can never collide with an existing same-day invoice either.
-- ---------------------------------------------------------------------------
create or replace function public.next_invoice_number(_business_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  biz_tz text;
  v_period text;
  existing_max int;
  n integer;
begin
  if _business_id is null or _business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  select coalesce(timezone, 'Africa/Lagos') into biz_tz from public.businesses where id = _business_id;
  v_period := to_char((now() at time zone biz_tz)::date, 'YYMMDD');

  -- Highest existing YYMMDD-N for today. The {1,6} bound excludes the 9-digit client fallback
  -- numbers (YYMMDD-<6 ts><3 rand>) so they can't push the counter to a huge value.
  select coalesce(max((regexp_replace(invoice_number, '^' || v_period || '-', ''))::int), 0)
    into existing_max
    from public.invoices
   where business_id = _business_id
     and invoice_number ~ ('^' || v_period || '-[0-9]{1,6}$');

  insert into public.doc_counters (business_id, scope, period, seq)
  values (_business_id, 'invoice', v_period, existing_max + 1)
  on conflict (business_id, scope, period)
  do update set seq = greatest(doc_counters.seq, existing_max) + 1
  returning seq into n;

  return v_period || '-' || n::text;
end;
$$;

grant execute on function public.next_invoice_number(uuid) to authenticated;

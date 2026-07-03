-- Export (international commercial) invoices: Owners/Managers generate a downloadable commercial
-- invoice from Inventory. The exporter (seller) block is an owner-managed profile on the business;
-- each invoice snapshots the seller so historical documents stay stable. Numbers run per business
-- per year via the existing atomic doc_counters (e.g. BIMKAF/EXP/2026/001).

-- 1. Exporter profile — owner-editable in Settings, prefilled onto the invoice form.
alter table public.businesses
  add column if not exists export_address        text,
  add column if not exists export_email          text,
  add column if not exists export_phone          text,
  add column if not exists export_country         text,
  add column if not exists export_invoice_prefix text;

-- 2. Saved export invoices (seller snapshot + buyer + line items + totals).
create table if not exists public.export_invoices (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  invoice_number    text not null,
  invoice_date      date not null default current_date,
  country_of_origin text,
  currency          text not null default 'NGN',
  -- Seller snapshot (captured at creation from the exporter profile).
  seller_name       text,
  seller_address    text,
  seller_email      text,
  seller_phone      text,
  -- Buyer (importer).
  buyer_name        text,
  buyer_address     text,
  buyer_country     text,
  -- Line items: [{ description, size, units_per_box, boxes, unit_price, total }]
  items             jsonb not null default '[]'::jsonb,
  subtotal          numeric not null default 0,
  total             numeric not null default 0,
  notes             text,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (business_id, invoice_number)
);

create index if not exists export_invoices_business_created_idx
  on public.export_invoices (business_id, created_at desc);

alter table public.export_invoices enable row level security;

create policy "biz members view export_invoices"   on public.export_invoices for select using (business_id = public.current_business_id());
create policy "biz members insert export_invoices"  on public.export_invoices for insert with check (business_id = public.current_business_id());
create policy "biz members update export_invoices"  on public.export_invoices for update using (business_id = public.current_business_id());
create policy "biz members delete export_invoices"  on public.export_invoices for delete using (business_id = public.current_business_id());

-- 3. Atomic per-business, per-year number: <PREFIX>/EXP/<YYYY>/<NNN>. Prefix comes from the exporter
--    profile, falling back to the first word of the business name (or 'INV').
create or replace function public.next_export_invoice_number(_business_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_year   text := to_char(now(), 'YYYY');
  v_seq    integer;
begin
  if _business_id is null or _business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  select coalesce(
           nullif(trim(export_invoice_prefix), ''),
           nullif(upper(regexp_replace(split_part(coalesce(name, ''), ' ', 1), '[^A-Za-z0-9]', '', 'g')), ''),
           'INV'
         )
    into v_prefix
  from public.businesses where id = _business_id;

  insert into public.doc_counters (business_id, scope, period, seq)
  values (_business_id, 'EXPORT', v_year, 1)
  on conflict (business_id, scope, period)
  do update set seq = public.doc_counters.seq + 1
  returning seq into v_seq;

  return v_prefix || '/EXP/' || v_year || '/' || lpad(v_seq::text, 3, '0');
end;
$$;

revoke all on function public.next_export_invoice_number(uuid) from public, anon;
grant execute on function public.next_export_invoice_number(uuid) to authenticated;

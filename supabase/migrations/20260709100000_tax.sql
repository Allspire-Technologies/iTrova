-- Tax (VAT) integration. Opt-in: businesses.tax_enabled is off by default, so nothing changes for
-- businesses that don't turn it on (most small shops are under the ₦25M VAT threshold). A `taxes`
-- catalogue is defined in Settings and mapped onto products; POS/invoices carry the VAT amount, and
-- Reports/Dashboard summarise net VAT (output − input, input captured on expenses).

-- Tax catalogue (defined in Settings; e.g. VAT 7.5%). Rate is a percent.
create table if not exists public.taxes (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null,
  rate        numeric not null default 0 check (rate >= 0),
  is_default  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists taxes_business_idx on public.taxes (business_id);

alter table public.taxes enable row level security;
create policy "biz members view taxes" on public.taxes for select
  using (business_id = public.current_business_id());
-- Tax setup is business configuration → owners/managers only (owner always passes).
create policy "owner/manager insert taxes" on public.taxes for insert
  with check (business_id = public.current_business_id()
    and (public.has_business_role(business_id, auth.uid(), 'owner') or public.has_business_role(business_id, auth.uid(), 'manager')));
create policy "owner/manager update taxes" on public.taxes for update
  using (business_id = public.current_business_id()
    and (public.has_business_role(business_id, auth.uid(), 'owner') or public.has_business_role(business_id, auth.uid(), 'manager')));
create policy "owner/manager delete taxes" on public.taxes for delete
  using (business_id = public.current_business_id()
    and (public.has_business_role(business_id, auth.uid(), 'owner') or public.has_business_role(business_id, auth.uid(), 'manager')));
grant select, insert, update, delete on public.taxes to authenticated;

-- Business-level tax settings.
alter table public.businesses
  add column if not exists tax_enabled boolean not null default false,
  add column if not exists prices_include_tax boolean not null default true,  -- NG retail tags are gross
  add column if not exists tin text;

-- Per-product mapping (NULL = exempt). New products default to the business default tax in the app.
alter table public.products
  add column if not exists tax_id uuid references public.taxes(id) on delete set null;

-- VAT amounts: output VAT on the sale, input VAT on the expense (bills).
alter table public.sales    add column if not exists tax_amount numeric not null default 0;
alter table public.expenses add column if not exists tax_amount numeric not null default 0;

notify pgrst, 'reload schema';

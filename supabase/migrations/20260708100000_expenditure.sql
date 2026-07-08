-- Expenditure module (paid): record business spending, track unpaid bills (Paid vs Pending + due
-- date), export, and feed Net profit into Reports. Mirrors the general_store / export_invoices
-- scaffolding — a business-scoped table with per-action write RLS gated on has_permission, plus an
-- app_modules registration. Plain CRUD (no RPCs); enabled per plan via plans.modules (not free).

create table if not exists public.expenses (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  expense_date   date not null default current_date,
  category       text not null,
  amount         numeric not null default 0 check (amount >= 0),
  payment_method text,
  payee          text,
  supplier_id    uuid references public.suppliers(id) on delete set null,
  description    text,
  status         text not null default 'paid' check (status in ('paid','pending')),
  due_date       date,
  paid_date      date,
  receipt_ref    text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists expenses_business_date_idx on public.expenses (business_id, expense_date desc);
create index if not exists expenses_business_status_due_idx on public.expenses (business_id, status, due_date);

alter table public.expenses enable row level security;

-- SELECT stays business-scoped; writes are per-action (owner always passes has_permission).
create policy "biz members view expenses" on public.expenses for select
  using (business_id = public.current_business_id());
create policy "perm create expenses" on public.expenses for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'create'));
create policy "perm edit expenses" on public.expenses for update
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'edit'));
create policy "perm delete expenses" on public.expenses for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'delete'));

grant select, insert, update, delete on public.expenses to authenticated;

insert into public.app_modules (key, label, path, sort_order)
values ('expenditure', 'Expenditure', '/expenditure', 18)
on conflict (key) do nothing;

notify pgrst, 'reload schema';

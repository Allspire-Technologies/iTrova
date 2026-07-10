-- Payroll & Salaries — a sub-section of the Expenditure module. A light employee registry (people
-- enrolled for pay, each linked to a General Store staff row, a Team member, or added manually) plus
-- pay runs (a pay period with one line per employee: gross pay − free-form deductions = net). Posting
-- a run creates one aggregate "Salaries" expense (total gross) so payroll flows into Reports/net-profit
-- via the existing expenses table. Gated by the existing `expenditure` permissions (no new module).

-- 1. Employee registry. A person is linked to store_staff OR a team member (user_id) OR neither
--    (manual). `name` is snapshotted so payslips survive the source being deleted.
create table if not exists public.payroll_employees (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  name           text not null,
  store_staff_id uuid references public.store_staff(id) on delete set null,
  user_id        uuid,                       -- a team member (auth user); no FK (auth schema)
  pay_type       text not null default 'monthly' check (pay_type in ('monthly','daily','hourly')),
  base_rate      numeric not null default 0 check (base_rate >= 0),
  bank_name      text,
  account_number text,
  account_name   text,
  notes          text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);
create index if not exists payroll_employees_business_idx on public.payroll_employees (business_id, active);

-- 2. Pay runs — one per pay period.
create table if not exists public.payroll_runs (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  period_label    text not null,             -- e.g. "July 2026"
  period_start    date,
  period_end      date,
  pay_date        date not null default current_date,
  status          text not null default 'draft' check (status in ('draft','posted')),
  expense_id      uuid references public.expenses(id) on delete set null,
  gross_total     numeric not null default 0,
  deduction_total numeric not null default 0,
  net_total       numeric not null default 0,
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists payroll_runs_business_idx on public.payroll_runs (business_id, pay_date desc);

-- 3. Pay-run lines — one per employee. Deductions are free-form: [{label, amount}].
create table if not exists public.payroll_run_lines (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,  -- denormalised for RLS
  run_id          uuid not null references public.payroll_runs(id) on delete cascade,
  employee_id     uuid references public.payroll_employees(id) on delete set null,
  employee_name   text not null,             -- snapshot for payslips
  gross_pay       numeric not null default 0 check (gross_pay >= 0),
  deductions      jsonb not null default '[]'::jsonb,
  deduction_total numeric not null default 0,
  net_pay         numeric not null default 0,
  notes           text
);
create index if not exists payroll_run_lines_run_idx on public.payroll_run_lines (run_id);

-- RLS: SELECT business-scoped; writes gated on the existing expenditure permissions (owner always
-- passes). Payroll reuses the Expenditure module's create/edit/delete actions.
alter table public.payroll_employees enable row level security;
alter table public.payroll_runs      enable row level security;
alter table public.payroll_run_lines enable row level security;

create policy "biz members view payroll_employees" on public.payroll_employees for select
  using (business_id = public.current_business_id());
create policy "perm create payroll_employees" on public.payroll_employees for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'create'));
create policy "perm edit payroll_employees" on public.payroll_employees for update
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'edit'));
create policy "perm delete payroll_employees" on public.payroll_employees for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'delete'));

create policy "biz members view payroll_runs" on public.payroll_runs for select
  using (business_id = public.current_business_id());
create policy "perm create payroll_runs" on public.payroll_runs for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'create'));
create policy "perm edit payroll_runs" on public.payroll_runs for update
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'edit'));
create policy "perm delete payroll_runs" on public.payroll_runs for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'delete'));

create policy "biz members view payroll_run_lines" on public.payroll_run_lines for select
  using (business_id = public.current_business_id());
create policy "perm create payroll_run_lines" on public.payroll_run_lines for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'create'));
create policy "perm edit payroll_run_lines" on public.payroll_run_lines for update
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'edit'));
create policy "perm delete payroll_run_lines" on public.payroll_run_lines for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'expenditure', 'delete'));

grant select, insert, update, delete on public.payroll_employees to authenticated;
grant select, insert, update, delete on public.payroll_runs      to authenticated;
grant select, insert, update, delete on public.payroll_run_lines to authenticated;
grant all on public.payroll_employees to service_role;
grant all on public.payroll_runs      to service_role;
grant all on public.payroll_run_lines to service_role;

notify pgrst, 'reload schema';

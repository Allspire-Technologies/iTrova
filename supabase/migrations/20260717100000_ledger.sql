-- Accounting v2 — double-entry general ledger foundation. Every financial event becomes a balanced
-- journal entry (debits = credits) against a chart of accounts; the Trial Balance and (later) all
-- statements derive from this one source of truth. This migration adds the schema + the seeding and
-- posting RPCs. Auto-posting of transactions and the RBAC action live in the next migration.

-- 1. Chart of accounts. `code` is a stable key the posting RPCs look up (e.g. '1000' Cash); system
--    accounts are seeded defaults that shouldn't be deleted.
create table if not exists public.accounts (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  code           text not null,
  name           text not null,
  type           text not null check (type in ('asset','liability','equity','income','expense')),
  is_system      boolean not null default false,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  unique (business_id, code)
);
create index if not exists accounts_business_idx on public.accounts (business_id, type);

-- 2. Journal entry header + its balanced lines.
create table if not exists public.journal_entries (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  entry_date  date not null default current_date,
  memo        text,
  source      text not null default 'manual' check (source in ('manual','opening','sale','expense','payment','payroll','purchase')),
  source_id   uuid,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists journal_entries_business_idx on public.journal_entries (business_id, entry_date desc);
create index if not exists journal_entries_source_idx on public.journal_entries (business_id, source, source_id);

create table if not exists public.journal_lines (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,  -- denormalised for RLS
  entry_id    uuid not null references public.journal_entries(id) on delete cascade,
  account_id  uuid not null references public.accounts(id) on delete restrict,
  debit       numeric not null default 0 check (debit >= 0),
  credit      numeric not null default 0 check (credit >= 0),
  description text,
  check (debit = 0 or credit = 0)  -- a line is either a debit or a credit, never both
);
create index if not exists journal_lines_entry_idx on public.journal_lines (entry_id);
create index if not exists journal_lines_account_idx on public.journal_lines (account_id);

-- RLS: members read everything; accounts are managed by the accounting.manage permission; journal
-- rows are written only through the posting RPCs (no direct client writes).
alter table public.accounts        enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines   enable row level security;

create policy "biz members view accounts" on public.accounts for select using (business_id = public.current_business_id());
create policy "perm manage accounts insert" on public.accounts for insert with check (business_id = public.current_business_id() and public.has_permission(business_id, 'accounting', 'manage'));
create policy "perm manage accounts update" on public.accounts for update using (business_id = public.current_business_id() and public.has_permission(business_id, 'accounting', 'manage'));
create policy "perm manage accounts delete" on public.accounts for delete using (business_id = public.current_business_id() and public.has_permission(business_id, 'accounting', 'manage') and not is_system);

create policy "biz members view journal_entries" on public.journal_entries for select using (business_id = public.current_business_id());
create policy "biz members view journal_lines"   on public.journal_lines   for select using (business_id = public.current_business_id());

grant select, insert, update, delete on public.accounts to authenticated;
grant select on public.journal_entries to authenticated;
grant select on public.journal_lines   to authenticated;
grant all on public.accounts        to service_role;
grant all on public.journal_entries to service_role;
grant all on public.journal_lines   to service_role;

-- Internal posting primitive (no permission check — callers gate). Validates debits = credits, then
-- writes the entry + lines. `_lines` = jsonb array of {account_id|account_code, debit, credit, description}.
create or replace function public._post_journal_impl(
  _business_id uuid, _entry_date date, _memo text, _source text, _source_id uuid, _lines jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_entry_id  uuid := gen_random_uuid();
  v_debits    numeric;
  v_credits   numeric;
  v_line      jsonb;
  v_account   uuid;
begin
  select coalesce(sum((l->>'debit')::numeric), 0), coalesce(sum((l->>'credit')::numeric), 0)
    into v_debits, v_credits
    from jsonb_array_elements(_lines) as l;

  if round(v_debits, 2) <> round(v_credits, 2) then
    raise exception 'UNBALANCED: debits % <> credits %', v_debits, v_credits using errcode = 'check_violation';
  end if;
  if round(v_debits, 2) = 0 then
    raise exception 'EMPTY_ENTRY' using errcode = 'check_violation';
  end if;

  insert into public.journal_entries (id, business_id, entry_date, memo, source, source_id, created_by)
  values (v_entry_id, _business_id, coalesce(_entry_date, current_date), nullif(_memo, ''), coalesce(_source, 'manual'), _source_id, auth.uid());

  for v_line in select * from jsonb_array_elements(_lines)
  loop
    -- Resolve the account by id or by code (posting rules pass codes).
    v_account := nullif(v_line->>'account_id', '')::uuid;
    if v_account is null and (v_line->>'account_code') is not null then
      select id into v_account from public.accounts where business_id = _business_id and code = v_line->>'account_code';
    end if;
    if v_account is null then raise exception 'ACCOUNT_NOT_FOUND: %', coalesce(v_line->>'account_code', v_line->>'account_id') using errcode = 'check_violation'; end if;

    insert into public.journal_lines (business_id, entry_id, account_id, debit, credit, description)
    values (_business_id, v_entry_id, v_account,
            round(coalesce((v_line->>'debit')::numeric, 0), 2),
            round(coalesce((v_line->>'credit')::numeric, 0), 2),
            nullif(v_line->>'description', ''));
  end loop;

  return v_entry_id;
end;
$$;
revoke all on function public._post_journal_impl(uuid, date, text, text, uuid, jsonb) from public, anon;

-- Public wrapper for MANUAL journal entries — checks the caller's accounting.manage permission.
create or replace function public.post_journal(_entry_date date, _memo text, _lines jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_business_id uuid := public.current_business_id();
begin
  if v_business_id is null then raise exception 'no active business'; end if;
  perform public.assert_permission(v_business_id, 'accounting', 'manage');
  return public._post_journal_impl(v_business_id, _entry_date, _memo, 'manual', null, _lines);
end;
$$;
revoke all on function public.post_journal(date, text, jsonb) from public, anon;
grant execute on function public.post_journal(date, text, jsonb) to authenticated;

-- Seed the default NG-SMB chart of accounts for a business (idempotent), and post the opening-balance
-- journal from businesses.opening_cash/opening_capital (plugged to Opening Balance Equity) once.
create or replace function public.ensure_chart_of_accounts()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_business_id uuid := public.current_business_id();
  v_cash        numeric;
  v_capital     numeric;
  v_open_date   date;
  v_lines       jsonb;
begin
  if v_business_id is null then raise exception 'no active business'; end if;
  perform public.assert_permission(v_business_id, 'accounting', 'view');

  if not exists (select 1 from public.accounts where business_id = v_business_id) then
    insert into public.accounts (business_id, code, name, type, is_system) values
      (v_business_id, '1000', 'Cash',                 'asset',     true),
      (v_business_id, '1010', 'Bank',                 'asset',     true),
      (v_business_id, '1100', 'Accounts Receivable',  'asset',     true),
      (v_business_id, '1200', 'Inventory',            'asset',     true),
      (v_business_id, '2000', 'Accounts Payable',     'liability', true),
      (v_business_id, '2100', 'VAT Payable',          'liability', true),
      (v_business_id, '3000', 'Owner''s Capital',     'equity',    true),
      (v_business_id, '3100', 'Retained Earnings',    'equity',    true),
      (v_business_id, '3900', 'Opening Balance Equity','equity',   true),
      (v_business_id, '4000', 'Sales',                'income',    true),
      (v_business_id, '5000', 'Cost of Goods Sold',   'expense',   true),
      (v_business_id, '6000', 'Operating Expenses',   'expense',   true);
  end if;

  -- Opening-balance journal: Dr Cash (opening_cash) / Cr Owner's Capital (opening_capital),
  -- difference plugged to Opening Balance Equity. Posted once (guard on source='opening').
  select opening_cash, opening_capital, books_opening_date
    into v_cash, v_capital, v_open_date
    from public.businesses where id = v_business_id;

  if coalesce(v_open_date, null) is not null
     and (coalesce(v_cash, 0) <> 0 or coalesce(v_capital, 0) <> 0)
     and not exists (select 1 from public.journal_entries where business_id = v_business_id and source = 'opening') then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1000', 'debit', coalesce(v_cash, 0),    'credit', 0, 'description', 'Opening cash'),
      jsonb_build_object('account_code', '3000', 'debit', 0, 'credit', coalesce(v_capital, 0),  'description', 'Opening capital'),
      -- plug so the entry balances: OBE credit if cash>capital, debit otherwise
      jsonb_build_object('account_code', '3900',
        'debit',  case when coalesce(v_capital,0) > coalesce(v_cash,0) then coalesce(v_capital,0) - coalesce(v_cash,0) else 0 end,
        'credit', case when coalesce(v_cash,0) > coalesce(v_capital,0) then coalesce(v_cash,0) - coalesce(v_capital,0) else 0 end,
        'description', 'Opening balance equity')
    );
    perform public._post_journal_impl(v_business_id, v_open_date, 'Opening balances', 'opening', null, v_lines);
  end if;
end;
$$;
revoke all on function public.ensure_chart_of_accounts() from public, anon;
grant execute on function public.ensure_chart_of_accounts() to authenticated;

notify pgrst, 'reload schema';

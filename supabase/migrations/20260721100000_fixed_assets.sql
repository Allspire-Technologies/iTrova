-- Assets Management: a fixed-asset register with straight-line depreciation, linked to the general
-- ledger. Each asset depreciates at its rate (default 20%/yr) off its original cost, reaching zero
-- after 1/rate years. Acquiring an asset posts Dr Fixed Assets / Cr Cash; "Run depreciation" posts
-- the charge to date (Dr Depreciation Expense / Cr Accumulated Depreciation) idempotently, so the
-- Balance Sheet shows net book value and the P&L shows depreciation — automatically, since the
-- statements read the ledger. Ledger postings are no-ops until the business has a chart of accounts.

create table if not exists public.fixed_assets (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  name              text not null,
  category          text,
  cost              numeric not null default 0 check (cost >= 0),
  year_purchased    int,
  depreciation_rate numeric not null default 0.20 check (depreciation_rate >= 0 and depreciation_rate <= 1),
  active            boolean not null default true,
  created_by        uuid,
  created_at        timestamptz not null default now()
);
create index if not exists fixed_assets_business_idx on public.fixed_assets (business_id, active);

alter table public.fixed_assets enable row level security;
create policy "biz members view fixed_assets" on public.fixed_assets for select using (business_id = public.current_business_id());
create policy "perm create fixed_assets" on public.fixed_assets for insert with check (business_id = public.current_business_id() and public.has_permission(business_id, 'assets', 'create'));
create policy "perm edit fixed_assets" on public.fixed_assets for update using (business_id = public.current_business_id() and public.has_permission(business_id, 'assets', 'edit'));
create policy "perm delete fixed_assets" on public.fixed_assets for delete using (business_id = public.current_business_id() and public.has_permission(business_id, 'assets', 'delete'));
grant select, insert, update, delete on public.fixed_assets to authenticated;
grant all on public.fixed_assets to service_role;

-- Allow the asset/depreciation journal sources.
alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check
  check (source in ('manual','opening','sale','invoice','expense','payment','payroll','purchase','production','asset','depreciation'));

-- Add the fixed-asset accounts to a business's chart (only when it already has one). Idempotent.
create or replace function public._ensure_asset_accounts(_business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.accounts where business_id = _business_id) then
    insert into public.accounts (business_id, code, name, type, is_system) values
      (_business_id, '1500', 'Fixed Assets',             'asset',   true),
      (_business_id, '1590', 'Accumulated Depreciation', 'asset',   true),
      (_business_id, '6100', 'Depreciation Expense',     'expense', true)
    on conflict (business_id, code) do nothing;
  end if;
end; $$;

-- Acquisition posting: Dr Fixed Assets / Cr Cash. Reverse-and-repost so edits/deletes stay in sync.
create or replace function public.sync_asset_journal(_id uuid, _business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  delete from public.journal_entries where business_id = _business_id and source = 'asset' and source_id = _id;
  if not exists (select 1 from public.accounts where business_id = _business_id) then return; end if;
  select * into v from public.fixed_assets where id = _id;
  if not found or coalesce(v.cost, 0) = 0 then return; end if;
  perform public._ensure_asset_accounts(_business_id);
  perform public._post_journal_impl(_business_id,
    coalesce(make_date(nullif(v.year_purchased, 0), 1, 1), current_date),
    'Asset: ' || v.name, 'asset', _id, jsonb_build_array(
      jsonb_build_object('account_code', '1500', 'debit', v.cost, 'credit', 0, 'description', v.name),
      jsonb_build_object('account_code', '1000', 'debit', 0, 'credit', v.cost, 'description', 'Cash')));
end; $$;

create or replace function public.trg_sync_asset() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public.sync_asset_journal(coalesce(NEW.id, OLD.id), coalesce(NEW.business_id, OLD.business_id));
  exception when others then null; end;
  return null;
end; $$;
drop trigger if exists sync_asset_journal_trg on public.fixed_assets;
create trigger sync_asset_journal_trg after insert or update or delete on public.fixed_assets
  for each row execute function public.trg_sync_asset();

-- Post straight-line depreciation to date for every asset — as a catch-up to the target accumulated
-- amount, so running it twice is a no-op and it self-corrects after cost/rate edits.
create or replace function public.run_depreciation()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_business_id uuid := public.current_business_id();
  v_year int := extract(year from current_date);
  v_asset record;
  v_years numeric; v_target numeric; v_posted numeric; v_delta numeric; v_count int := 0;
begin
  if v_business_id is null then raise exception 'no active business'; end if;
  perform public.assert_permission(v_business_id, 'assets', 'depreciate');
  if not exists (select 1 from public.accounts where business_id = v_business_id) then
    raise exception 'NO_CHART' using errcode = 'check_violation';
  end if;
  perform public._ensure_asset_accounts(v_business_id);

  for v_asset in select * from public.fixed_assets where business_id = v_business_id and active loop
    v_years  := greatest(0, v_year - coalesce(v_asset.year_purchased, v_year));
    v_target := least(coalesce(v_asset.cost, 0), coalesce(v_asset.cost, 0) * coalesce(v_asset.depreciation_rate, 0) * v_years);
    select coalesce(sum(jl.credit), 0) into v_posted
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.entry_id
      join public.accounts a on a.id = jl.account_id
      where je.business_id = v_business_id and je.source = 'depreciation' and je.source_id = v_asset.id and a.code = '1590';
    v_delta := round(v_target - v_posted, 2);
    if v_delta > 0.005 then
      perform public._post_journal_impl(v_business_id, current_date, 'Depreciation: ' || v_asset.name, 'depreciation', v_asset.id,
        jsonb_build_array(
          jsonb_build_object('account_code', '6100', 'debit', v_delta, 'credit', 0, 'description', v_asset.name),
          jsonb_build_object('account_code', '1590', 'debit', 0, 'credit', v_delta, 'description', 'Accumulated depreciation')));
      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object('posted', v_count);
end; $$;
revoke all on function public.run_depreciation() from public, anon;
grant execute on function public.run_depreciation() to authenticated;

notify pgrst, 'reload schema';

-- Accounting v2 — phase 3a: post raw-material purchases (deliveries) to the ledger, and capture
-- OPENING INVENTORY in the opening journal so the ledger's Inventory starts from real stock value.
-- (Product purchase-order receiving posts in a later phase; until then its stock is absorbed by
-- Opening Balance Equity and the statements still tie by construction.)

-- ---- Raw-material purchases: Dr Inventory (net + landed) + Dr VAT Payable (input) / Cr Cash
create or replace function public.sync_purchase_journal(_id uuid, _business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_tax numeric; v_landed numeric; v_goods numeric; v_cash numeric; v_lines jsonb;
begin
  delete from public.journal_entries where business_id = _business_id and source = 'purchase' and source_id = _id;
  if not exists (select 1 from public.accounts where business_id = _business_id) then return; end if;
  select * into v from public.material_purchases where id = _id;
  if not found then return; end if;

  v_goods  := coalesce(v.total_cost, 0);
  v_landed := coalesce(v.landed_total, 0);
  v_tax    := coalesce(v.tax_amount, 0);
  v_cash   := v_goods + v_landed;               -- total cash out (goods incl. VAT + landed costs)
  if v_cash = 0 then return; end if;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1200', 'debit', v_goods - v_tax + v_landed, 'credit', 0, 'description', 'Stock purchased'));
  if v_tax > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '2100', 'debit', v_tax, 'credit', 0, 'description', 'Input VAT'));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '1000', 'debit', 0, 'credit', v_cash, 'description', 'Cash paid'));

  perform public._post_journal_impl(_business_id, v.created_at::date, 'Stock purchase', 'purchase', _id, v_lines);
end; $$;

create or replace function public.trg_sync_purchase() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public.sync_purchase_journal(coalesce(NEW.id, OLD.id), coalesce(NEW.business_id, OLD.business_id));
  exception when others then null; end;
  return null;
end; $$;
drop trigger if exists sync_purchase_journal_trg on public.material_purchases;
create trigger sync_purchase_journal_trg after insert or update or delete on public.material_purchases
  for each row execute function public.trg_sync_purchase();

-- ---- Re-declare ensure_chart_of_accounts: opening journal now also books OPENING INVENTORY (current
-- stock at cost) so the ledger's Inventory reflects reality from day one. Plug to Opening Balance Equity.
create or replace function public.ensure_chart_of_accounts()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_business_id uuid := public.current_business_id();
  v_cash numeric; v_capital numeric; v_open_date date; v_inv numeric; v_plug numeric; v_lines jsonb;
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

  select opening_cash, opening_capital, books_opening_date
    into v_cash, v_capital, v_open_date
    from public.businesses where id = v_business_id;

  select coalesce((select sum(stock_quantity * coalesce(cost_price, 0)) from public.products where business_id = v_business_id), 0)
       + coalesce((select sum(stock_quantity * coalesce(cost_per_unit, 0)) from public.raw_materials where business_id = v_business_id), 0)
    into v_inv;

  if coalesce(v_open_date, null) is not null
     and (coalesce(v_cash, 0) <> 0 or coalesce(v_capital, 0) <> 0 or coalesce(v_inv, 0) <> 0)
     and not exists (select 1 from public.journal_entries where business_id = v_business_id and source = 'opening') then
    -- Dr Cash + Dr Inventory / Cr Owner's Capital, Opening Balance Equity plugs the difference.
    v_plug := (coalesce(v_cash, 0) + coalesce(v_inv, 0)) - coalesce(v_capital, 0);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_code', '1000', 'debit', coalesce(v_cash, 0), 'credit', 0, 'description', 'Opening cash'),
      jsonb_build_object('account_code', '1200', 'debit', coalesce(v_inv, 0),  'credit', 0, 'description', 'Opening inventory'),
      jsonb_build_object('account_code', '3000', 'debit', 0, 'credit', coalesce(v_capital, 0), 'description', 'Opening capital'),
      jsonb_build_object('account_code', '3900',
        'debit',  case when v_plug < 0 then -v_plug else 0 end,
        'credit', case when v_plug > 0 then  v_plug else 0 end,
        'description', 'Opening balance equity'));
    perform public._post_journal_impl(v_business_id, v_open_date, 'Opening balances', 'opening', null, v_lines);
  end if;
end; $$;
revoke all on function public.ensure_chart_of_accounts() from public, anon;
grant execute on function public.ensure_chart_of_accounts() to authenticated;

notify pgrst, 'reload schema';

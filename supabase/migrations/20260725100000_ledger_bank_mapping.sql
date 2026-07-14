-- Ledger refinement: money-in now posts to Cash (1000) or Bank (1010) by payment method,
-- instead of everything landing in Cash. Split-aware for POS sales via sale_payments.
--
--   POS methods:      cash → 1000 · transfer / pos → 1010
--   Deposit methods:  cash / other → 1000 · bank transfer / card / mobile money → 1010
--
-- One shared rule: "cash" and "other" (or unknown) → 1000; every named electronic method → 1010.
-- Defensive: if a business has deactivated (or somehow lacks) its 1010 Bank account, everything
-- posts to 1000 as before — the mapping never breaks a posting.
-- Forward-only: existing journals are not reposted (sales post once, guarded by source_id);
-- invoice-payment journals are reverse-and-repost, so any edit re-posts with the new mapping.

-- Map a payment method string onto the receiving account code.
create or replace function public._money_in_account(_method text, _has_bank boolean)
returns text language sql immutable as $$
  select case
    when not _has_bank then '1000'
    when lower(coalesce(_method, 'cash')) in ('cash', 'other', 'split') then '1000'
    else '1010'
  end;
$$;

-- Re-declare post_sale_journal (last set in 20260717110000_ledger_autopost_sales): identical except
-- the single "Dr Cash (total)" line becomes up to two Dr lines split by method from sale_payments.
create or replace function public.post_sale_journal(_business_id uuid, _sale_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_total    numeric;
  v_tax      numeric;
  v_cogs     numeric;
  v_created  date;
  v_lines    jsonb;
  v_has_bank boolean;
  v_cash     numeric := 0;
  v_bank     numeric := 0;
  v_method   text;
begin
  if not exists (select 1 from public.accounts where business_id = _business_id) then return; end if;
  if exists (select 1 from public.journal_entries where business_id = _business_id and source = 'sale' and source_id = _sale_id) then return; end if;

  select total_amount, coalesce(tax_amount, 0), created_at::date
    into v_total, v_tax, v_created
    from public.sales where id = _sale_id and business_id = _business_id;
  if not found then return; end if;

  select coalesce(sum(quantity * coalesce(unit_cost, 0)), 0) into v_cogs
    from public.sale_items where sale_id = _sale_id;

  v_has_bank := exists (select 1 from public.accounts where business_id = _business_id and code = '1010' and active);

  -- Split the receipt across Cash/Bank from the per-method rows (split-aware); a sale with no
  -- sale_payments rows (shouldn't happen post-backfill) falls back to its single payment_method.
  select coalesce(sum(amount) filter (where public._money_in_account(method, v_has_bank) = '1000'), 0),
         coalesce(sum(amount) filter (where public._money_in_account(method, v_has_bank) = '1010'), 0)
    into v_cash, v_bank
    from public.sale_payments where sale_id = _sale_id;
  if v_cash + v_bank = 0 then
    select payment_method into v_method from public.sales where id = _sale_id;
    if public._money_in_account(v_method, v_has_bank) = '1010' then v_bank := v_total; else v_cash := v_total; end if;
  end if;

  -- Dr Cash/Bank (receipt) / Cr Sales (net) / Cr VAT Payable (tax); plus Dr COGS / Cr Inventory when known.
  v_lines := '[]'::jsonb;
  if v_cash > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '1000', 'debit', v_cash, 'credit', 0, 'description', 'POS sale receipt (cash)'));
  end if;
  if v_bank > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '1010', 'debit', v_bank, 'credit', 0, 'description', 'POS sale receipt (bank)'));
  end if;
  v_lines := v_lines || jsonb_build_array(
    jsonb_build_object('account_code', '4000', 'debit', 0, 'credit', v_total - v_tax, 'description', 'Sales (net of VAT)')
  );
  if v_tax > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '2100', 'debit', 0, 'credit', v_tax, 'description', 'Output VAT'));
  end if;
  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code', '5000', 'debit', v_cogs, 'credit', 0, 'description', 'Cost of goods sold'),
      jsonb_build_object('account_code', '1200', 'debit', 0, 'credit', v_cogs, 'description', 'Inventory reduction')
    );
  end if;

  perform public._post_journal_impl(_business_id, v_created, 'POS sale', 'sale', _sale_id, v_lines);
end;
$$;
revoke all on function public.post_sale_journal(uuid, uuid) from public, anon;

-- Re-declare sync_payment_journal (last set in 20260718100000_ledger_autopost_expenses_ar):
-- identical except the Dr account follows the deposit's method instead of always Cash.
create or replace function public.sync_payment_journal(_id uuid, _business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v record;
  v_has_bank boolean;
  v_account text;
begin
  delete from public.journal_entries where business_id = _business_id and source = 'payment' and source_id = _id;
  if not exists (select 1 from public.accounts where business_id = _business_id) then return; end if;
  select * into v from public.invoice_payments where id = _id;
  if not found or coalesce(v.amount, 0) = 0 then return; end if;

  v_has_bank := exists (select 1 from public.accounts where business_id = _business_id and code = '1010' and active);
  v_account := public._money_in_account(v.method, v_has_bank);

  perform public._post_journal_impl(_business_id, v.created_at::date, 'Invoice payment', 'payment', _id, jsonb_build_array(
    jsonb_build_object('account_code', v_account, 'debit', coalesce(v.amount, 0), 'credit', 0,
      'description', case when v_account = '1010' then 'Payment received (bank)' else 'Payment received (cash)' end),
    jsonb_build_object('account_code', '1100', 'debit', 0, 'credit', coalesce(v.amount, 0), 'description', 'Settles receivable')));
end; $$;

notify pgrst, 'reload schema';

-- Accounting v2 — phase 2: auto-post the expense side (expenses, incl. payroll's Salaries expense) and
-- the receivables cycle (manual invoices issued, and payments received). Each uses a "reverse and
-- repost" sync: delete this source's existing journal, then re-post from current data — so edits, voids
-- and deletes stay in sync. Every sync runs from an exception-safe trigger wrapper, so a ledger problem
-- can never break the underlying expense/invoice/payment write. No-op until the business has a chart.

-- Allow the new 'invoice' journal source (manual invoice issuance).
alter table public.journal_entries drop constraint if exists journal_entries_source_check;
alter table public.journal_entries add constraint journal_entries_source_check
  check (source in ('manual','opening','sale','invoice','expense','payment','payroll','purchase'));

-- ---- Expenses: Dr Operating Expenses (net) + Dr VAT Payable (input VAT) / Cr Cash (paid) or A/P (pending)
create or replace function public.sync_expense_journal(_id uuid, _business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_net numeric; v_tax numeric; v_lines jsonb;
begin
  delete from public.journal_entries where business_id = _business_id and source = 'expense' and source_id = _id;
  if not exists (select 1 from public.accounts where business_id = _business_id) then return; end if;
  select * into v from public.expenses where id = _id;
  if not found or coalesce(v.amount, 0) = 0 then return; end if;

  v_tax := coalesce(v.tax_amount, 0);
  v_net := coalesce(v.amount, 0) - v_tax;
  v_lines := jsonb_build_array(jsonb_build_object('account_code', '6000', 'debit', v_net, 'credit', 0, 'description', v.category));
  if v_tax > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '2100', 'debit', v_tax, 'credit', 0, 'description', 'Input VAT'));
  end if;
  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'account_code', case when v.status = 'paid' then '1000' else '2000' end,
    'debit', 0, 'credit', coalesce(v.amount, 0),
    'description', case when v.status = 'paid' then 'Cash paid' else 'Payable' end));

  perform public._post_journal_impl(_business_id, v.expense_date, 'Expense: ' || coalesce(v.category, 'Expense'), 'expense', _id, v_lines);
end; $$;

create or replace function public.trg_sync_expense() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public.sync_expense_journal(coalesce(NEW.id, OLD.id), coalesce(NEW.business_id, OLD.business_id));
  exception when others then null; end;
  return null;
end; $$;
drop trigger if exists sync_expense_journal_trg on public.expenses;
create trigger sync_expense_journal_trg after insert or update or delete on public.expenses
  for each row execute function public.trg_sync_expense();

-- ---- Manual invoices (sale_id null; POS invoices already post via the sale): Dr A/R / Cr Sales / Cr VAT
create or replace function public.sync_invoice_journal(_id uuid, _business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_tax numeric; v_lines jsonb;
begin
  delete from public.journal_entries where business_id = _business_id and source = 'invoice' and source_id = _id;
  if not exists (select 1 from public.accounts where business_id = _business_id) then return; end if;
  select * into v from public.invoices where id = _id;
  if not found or v.sale_id is not null or coalesce(v.total, 0) = 0 then return; end if;
  if v.status in ('draft', 'void') then return; end if;  -- unrecognised / reversed (delete above stands)

  v_tax := coalesce(v.tax, 0);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1100', 'debit', coalesce(v.total, 0), 'credit', 0, 'description', 'Invoice ' || coalesce(v.invoice_number, '')),
    jsonb_build_object('account_code', '4000', 'debit', 0, 'credit', coalesce(v.total, 0) - v_tax, 'description', 'Sales (net of VAT)'));
  if v_tax > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code', '2100', 'debit', 0, 'credit', v_tax, 'description', 'Output VAT'));
  end if;

  perform public._post_journal_impl(_business_id, v.issue_date, 'Invoice ' || coalesce(v.invoice_number, ''), 'invoice', _id, v_lines);
end; $$;

create or replace function public.trg_sync_invoice() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public.sync_invoice_journal(coalesce(NEW.id, OLD.id), coalesce(NEW.business_id, OLD.business_id));
  exception when others then null; end;
  return null;
end; $$;
drop trigger if exists sync_invoice_journal_trg on public.invoices;
create trigger sync_invoice_journal_trg after insert or update or delete on public.invoices
  for each row execute function public.trg_sync_invoice();

-- ---- Invoice payments: Dr Cash / Cr Accounts Receivable
create or replace function public.sync_payment_journal(_id uuid, _business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  delete from public.journal_entries where business_id = _business_id and source = 'payment' and source_id = _id;
  if not exists (select 1 from public.accounts where business_id = _business_id) then return; end if;
  select * into v from public.invoice_payments where id = _id;
  if not found or coalesce(v.amount, 0) = 0 then return; end if;

  perform public._post_journal_impl(_business_id, v.created_at::date, 'Invoice payment', 'payment', _id, jsonb_build_array(
    jsonb_build_object('account_code', '1000', 'debit', coalesce(v.amount, 0), 'credit', 0, 'description', 'Payment received'),
    jsonb_build_object('account_code', '1100', 'debit', 0, 'credit', coalesce(v.amount, 0), 'description', 'Settles receivable')));
end; $$;

create or replace function public.trg_sync_payment() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin perform public.sync_payment_journal(coalesce(NEW.id, OLD.id), coalesce(NEW.business_id, OLD.business_id));
  exception when others then null; end;
  return null;
end; $$;
drop trigger if exists sync_payment_journal_trg on public.invoice_payments;
create trigger sync_payment_journal_trg after insert or update or delete on public.invoice_payments
  for each row execute function public.trg_sync_payment();

notify pgrst, 'reload schema';

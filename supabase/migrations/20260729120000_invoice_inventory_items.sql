-- Invoice inventory items + edit reconciliation.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Today an invoice line is pure free-text (no product link). This lets a line reference an inventory
-- PRODUCT, which deducts finished stock exactly like a POS sale (raw materials stay a production-time
-- concern — a POS sale deducts finished stock only, so we mirror that). Custom free-text lines keep
-- working (product_id null). Editing an invoice reconciles stock by the per-product delta (old vs new),
-- and a valid code-style oversell guard blocks selling more than is in stock.
--
-- Accounting: inventory invoices stay proper A/R invoices (correct for part payment) — the existing
-- sync_invoice_journal posts Dr A/R / Cr Sales / Cr VAT on issue and payments post Dr Cash / Cr A/R.
-- We only ADD the cost-of-goods legs (Dr COGS / Cr Inventory) from the line costs. We do NOT create a
-- POS-style "sale" row (that journal debits Cash in full and would mis-post a credit invoice).

-- ---------------------------------------------------------------- 1. line ↔ product link + cost snapshot
alter table public.invoice_items add column if not exists product_id uuid references public.products(id) on delete set null;
alter table public.invoice_items add column if not exists unit_cost numeric(12,2) not null default 0;
create index if not exists invoice_items_product_idx on public.invoice_items(product_id);

-- ---------------------------------------------------------------- 2. atomic save (create + edit, stock-reconciling)
-- Handles both manual invoices (sale_id null) and POS-originated invoices (sale_id set). For a POS
-- invoice the linked sale_items are the source of truth for stock/COGS/Reports, so we reconcile those
-- and re-post the sale journal; for a manual invoice we reconcile against its own inventory lines.
create or replace function public.save_invoice(_payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_business_id uuid := (_payload->>'business_id')::uuid;
  v_invoice_id  uuid := nullif(_payload->>'invoice_id', '')::uuid;
  v_sale_id     uuid := nullif(_payload->>'sale_id', '')::uuid;
  v_is_edit     boolean := v_invoice_id is not null;
  v_number      text;
  v_status      text := coalesce(nullif(_payload->>'status', ''), 'issued');
  v_row         record;
  v_name        text;
begin
  if v_business_id is null or v_business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  -- Apply the net per-product stock delta (desired − already-committed). delta > 0 deducts (with an
  -- oversell guard that blocks the whole save), delta < 0 returns stock. Custom lines (null product) skip.
  for v_row in
    with desired as (
      select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::numeric) as qty
      from jsonb_array_elements(_payload->'items') e
      where nullif(e->>'product_id', '') is not null
      group by 1
    ),
    current_q as (
      select product_id, sum(qty) as qty from (
        -- POS invoice edit: reconcile against the sale's items
        select si.product_id, si.quantity as qty
          from public.sale_items si
         where v_is_edit and v_sale_id is not null and si.sale_id = v_sale_id
        union all
        -- Manual invoice edit: reconcile against the invoice's own inventory lines
        select ii.product_id, ii.quantity
          from public.invoice_items ii
         where v_is_edit and v_sale_id is null and ii.invoice_id = v_invoice_id and ii.product_id is not null
      ) s
      group by 1
    )
    select coalesce(d.product_id, c.product_id) as product_id,
           coalesce(d.qty, 0) - coalesce(c.qty, 0) as delta
    from desired d full outer join current_q c on c.product_id = d.product_id
  loop
    if coalesce(v_row.delta, 0) = 0 then continue; end if;
    if v_row.delta > 0 then
      update public.products
         set stock_quantity = stock_quantity - v_row.delta
       where id = v_row.product_id and business_id = v_business_id and stock_quantity >= v_row.delta;
      if not found then
        select name into v_name from public.products where id = v_row.product_id;
        raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'an item') using errcode = 'check_violation';
      end if;
    else
      update public.products
         set stock_quantity = stock_quantity + (-v_row.delta)
       where id = v_row.product_id and business_id = v_business_id;
    end if;
  end loop;

  -- ---- Invoice header
  if not v_is_edit then
    v_number := coalesce(nullif(_payload->>'invoice_number', ''), public.next_invoice_number(v_business_id));
    insert into public.invoices (business_id, invoice_number, customer_name, customer_phone, customer_email,
        notes, due_date, status, subtotal, discount_amount, tax, total, created_by, issue_date)
    values (v_business_id, v_number, _payload->>'customer_name', nullif(_payload->>'customer_phone', ''),
        nullif(_payload->>'customer_email', ''), nullif(_payload->>'notes', ''), nullif(_payload->>'due_date', '')::date,
        v_status, (_payload->>'subtotal')::numeric, coalesce((_payload->>'discount')::numeric, 0),
        coalesce((_payload->>'tax')::numeric, 0), (_payload->>'total')::numeric,
        nullif(_payload->>'created_by', '')::uuid, coalesce(nullif(_payload->>'issue_date', '')::date, current_date))
    returning id, invoice_number into v_invoice_id, v_number;
  else
    update public.invoices set
      customer_name   = _payload->>'customer_name',
      customer_phone  = nullif(_payload->>'customer_phone', ''),
      customer_email  = nullif(_payload->>'customer_email', ''),
      notes           = nullif(_payload->>'notes', ''),
      due_date        = nullif(_payload->>'due_date', '')::date,
      subtotal        = (_payload->>'subtotal')::numeric,
      discount_amount = coalesce((_payload->>'discount')::numeric, 0),
      tax             = coalesce((_payload->>'tax')::numeric, 0),
      total           = (_payload->>'total')::numeric
    where id = v_invoice_id and business_id = v_business_id
    returning invoice_number into v_number;
    if v_number is null then raise exception 'invoice not found'; end if;
  end if;

  -- ---- Line items (replace-in-full). unit_cost snapshots the product's current cost for COGS.
  delete from public.invoice_items where invoice_id = v_invoice_id;
  insert into public.invoice_items (invoice_id, product_id, description, quantity, unit_price, line_total, unit_cost)
  select v_invoice_id, nullif(e->>'product_id', '')::uuid, e->>'description',
         (e->>'quantity')::numeric, (e->>'unit_price')::numeric,
         (e->>'quantity')::numeric * (e->>'unit_price')::numeric,
         coalesce(p.cost_price, 0)
  from jsonb_array_elements(_payload->'items') e
  left join public.products p on p.id = nullif(e->>'product_id', '')::uuid and p.business_id = v_business_id;

  -- ---- POS invoice: mirror the quantity changes onto the sale so Reports + the sale journal stay right.
  if v_is_edit and v_sale_id is not null then
    update public.sale_items si
       set quantity = d.qty
      from (
        select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::numeric) as qty
        from jsonb_array_elements(_payload->'items') e
        where nullif(e->>'product_id', '') is not null
        group by 1
      ) d
     where si.sale_id = v_sale_id and si.product_id = d.product_id;
    update public.sales set
       total_amount    = (_payload->>'total')::numeric,
       discount_amount = coalesce((_payload->>'discount')::numeric, 0),
       tax_amount      = coalesce((_payload->>'tax')::numeric, 0)
     where id = v_sale_id and business_id = v_business_id;
    -- Reverse & repost the sale's ledger entry from the new figures (never let it fail the save).
    begin
      delete from public.journal_entries where business_id = v_business_id and source = 'sale' and source_id = v_sale_id;
      perform public.post_sale_journal(v_business_id, v_sale_id);
    exception when others then null; end;
  end if;

  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_number);
end;
$$;
revoke all on function public.save_invoice(jsonb) from public, anon;
grant execute on function public.save_invoice(jsonb) to authenticated;

-- ---------------------------------------------------------------- 3. cost-of-goods on manual invoices
-- Re-declare sync_invoice_journal to add Dr COGS / Cr Inventory from the invoice's line costs (only
-- manual invoices, sale_id null; POS invoices post COGS via the sale journal). Revenue/VAT unchanged.
create or replace function public.sync_invoice_journal(_id uuid, _business_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record; v_tax numeric; v_cogs numeric; v_lines jsonb;
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

  -- Cost of goods for inventory lines (Dr COGS / Cr Inventory) — mirrors the POS sale journal.
  select coalesce(sum(quantity * coalesce(unit_cost, 0)), 0) into v_cogs from public.invoice_items where invoice_id = _id;
  if v_cogs > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_code', '5000', 'debit', v_cogs, 'credit', 0, 'description', 'Cost of goods sold'),
      jsonb_build_object('account_code', '1200', 'debit', 0, 'credit', v_cogs, 'description', 'Inventory reduction'));
  end if;

  perform public._post_journal_impl(_business_id, v.issue_date, 'Invoice ' || coalesce(v.invoice_number, ''), 'invoice', _id, v_lines);
end; $$;

-- The invoice journal now depends on invoice_items (for COGS), so re-sync when line items change too —
-- otherwise the COGS legs are missed (items are written after the invoice row in save_invoice).
create or replace function public.trg_sync_invoice_from_items() returns trigger language plpgsql security definer set search_path = public as $$
declare v_inv uuid := coalesce(NEW.invoice_id, OLD.invoice_id); v_biz uuid;
begin
  select business_id into v_biz from public.invoices where id = v_inv;
  if v_biz is not null then
    begin perform public.sync_invoice_journal(v_inv, v_biz); exception when others then null; end;
  end if;
  return null;
end; $$;
drop trigger if exists sync_invoice_items_journal_trg on public.invoice_items;
create trigger sync_invoice_items_journal_trg after insert or update or delete on public.invoice_items
  for each row execute function public.trg_sync_invoice_from_items();

-- ---------------------------------------------------------------- 4. return stock when a manual invoice is voided
-- POS invoices already restock via reverse_sale_on_void (keyed off sale_id). Manual invoices have no
-- sale, so add a matching handler that returns each inventory line's finished stock on void.
create or replace function public.reverse_invoice_stock_on_void() returns trigger language plpgsql security definer set search_path = public as $$
declare item record;
begin
  if NEW.status = 'void' and coalesce(OLD.status, '') <> 'void' and NEW.sale_id is null then
    for item in select product_id, quantity from public.invoice_items where invoice_id = NEW.id and product_id is not null loop
      update public.products set stock_quantity = stock_quantity + item.quantity where id = item.product_id;
    end loop;
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_reverse_invoice_stock_on_void on public.invoices;
create trigger trg_reverse_invoice_stock_on_void after update on public.invoices
  for each row execute function public.reverse_invoice_stock_on_void();

-- ---------------------------------------------------------------- 5. delete returns stock for manual invoices too
-- Re-declare delete_invoice so it voids the invoice first whether or not it has a sale — that fires the
-- right restock handler (reverse_sale_on_void for POS, reverse_invoice_stock_on_void for manual) before
-- the row (and its items) are removed.
create or replace function public.delete_invoice(_invoice_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_inv     record;
  v_sale_id uuid;
begin
  select * into v_inv from public.invoices where id = _invoice_id;
  if not found then raise exception 'invoice not found'; end if;
  if v_inv.business_id is null or v_inv.business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  v_sale_id := v_inv.sale_id;

  -- Void first to return stock (POS: reverse_sale_on_void; manual inventory: reverse_invoice_stock_on_void).
  -- Skip when already void — stock was already returned, and re-voiding would not re-trigger.
  if coalesce(v_inv.status, '') <> 'void' then
    update public.invoices set status = 'void' where id = _invoice_id;
  end if;

  delete from public.invoices where id = _invoice_id;
  if v_sale_id is not null then
    delete from public.sales where id = v_sale_id;
  end if;
end;
$$;
revoke all on function public.delete_invoice(uuid) from public, anon;
grant execute on function public.delete_invoice(uuid) to authenticated;

notify pgrst, 'reload schema';

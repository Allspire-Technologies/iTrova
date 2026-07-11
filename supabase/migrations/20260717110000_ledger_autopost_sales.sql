-- Accounting v2 — (a) add the accounting.manage permission (post journals / manage the chart), and
-- (b) auto-post every POS sale to the ledger. Re-declares default_role_permissions (drift-guard test
-- now parses THIS migration) and commit_offline_sale (adds the ledger posting at the end, wrapped so a
-- posting error can never fail a sale).

-- RBAC_DEFAULTS_JSON_START
create or replace function public.default_role_permissions(_role public.app_role)
returns jsonb
language sql immutable
as $$
  select case _role
    when 'manager' then '{
      "inventory": ["view","create","edit","adjust_stock","csv_import","csv_export"],
      "pos": ["view","orders_manage","orders_delete","eod_report","review_offline"],
      "suppliers": ["view","create","edit","delete","csv_import","csv_export"],
      "raw_materials": ["view","create","edit","record_purchase","adjust_stock","link_product","reorder","approve_requests","reject_requests","csv_import","csv_export"],
      "invoices": ["view","create","edit","status_change","record_payment","delete","print","download","csv_export"],
      "export_invoices": ["view","create","download"],
      "purchase_orders": ["view","create","status_change","receive","delete","download","csv_import","csv_export"],
      "general_store": ["view","item_manage","staff_manage","checkout","return","csv_import"],
      "production": ["view","request","produce"],
      "expenditure": ["view","create","edit","delete","export","csv_import","csv_export"],
      "reports": ["view","export"],
      "accounting": ["view","export","manage"]
    }'::jsonb
    when 'cashier' then '{
      "pos": ["view","orders_manage"],
      "invoices": ["view","create","print"]
    }'::jsonb
    else '{}'::jsonb
  end;
$$;
-- RBAC_DEFAULTS_JSON_END

-- Post a POS sale to the ledger (internal; called from commit_offline_sale). No-op if the business
-- hasn't set up its chart of accounts, or if this sale was already posted.
create or replace function public.post_sale_journal(_business_id uuid, _sale_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_total   numeric;
  v_tax     numeric;
  v_cogs    numeric;
  v_created date;
  v_lines   jsonb;
begin
  if not exists (select 1 from public.accounts where business_id = _business_id) then return; end if;
  if exists (select 1 from public.journal_entries where business_id = _business_id and source = 'sale' and source_id = _sale_id) then return; end if;

  select total_amount, coalesce(tax_amount, 0), created_at::date
    into v_total, v_tax, v_created
    from public.sales where id = _sale_id and business_id = _business_id;
  if not found then return; end if;

  select coalesce(sum(quantity * coalesce(unit_cost, 0)), 0) into v_cogs
    from public.sale_items where sale_id = _sale_id;

  -- Dr Cash (total) / Cr Sales (net) / Cr VAT Payable (tax); plus Dr COGS / Cr Inventory when known.
  v_lines := jsonb_build_array(
    jsonb_build_object('account_code', '1000', 'debit', v_total, 'credit', 0, 'description', 'POS sale receipt'),
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

-- Re-declare commit_offline_sale (last set in 20260715100000_sale_item_cost) — identical except the
-- final step now posts the sale to the ledger, in a sub-block so a ledger error never fails the sale.
create or replace function public.commit_offline_sale(_sale jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := (_sale->>'business_id')::uuid;
  v_sale_id     uuid := (_sale->>'sale_id')::uuid;
  v_invoice_id  uuid := (_sale->>'invoice_id')::uuid;
  v_created_at  timestamptz := coalesce((_sale->>'created_at')::timestamptz, now());
  v_tax         numeric := coalesce((_sale->>'tax')::numeric, 0);
  v_item        record;
  v_name        text;
begin
  if v_business_id is null or v_business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  if exists (select 1 from public.sales where id = v_sale_id) then
    return jsonb_build_object('status', 'duplicate', 'sale_id', v_sale_id);
  end if;

  for v_item in
    select (e->>'product_id')::uuid as product_id, (e->>'quantity')::numeric as qty
    from jsonb_array_elements(_sale->'items') as e
  loop
    if v_item.qty is null or v_item.qty <= 0 then continue; end if;
    update public.products
       set stock_quantity = stock_quantity - v_item.qty
     where id = v_item.product_id and business_id = v_business_id and stock_quantity >= v_item.qty;
    if not found then
      select name into v_name from public.products where id = v_item.product_id;
      raise exception 'NEEDS_REVIEW:%', coalesce(v_name, 'an item') using errcode = 'check_violation';
    end if;
  end loop;

  insert into public.sales (id, business_id, staff_id, total_amount, discount_amount, tax_amount, payment_method, created_at)
  values (v_sale_id, v_business_id, (_sale->>'staff_id')::uuid,
          (_sale->>'total')::numeric, (_sale->>'discount')::numeric, v_tax, _sale->>'payment_method', v_created_at);

  insert into public.sale_items (sale_id, product_id, quantity, unit_price, unit_cost)
  select v_sale_id, (e->>'product_id')::uuid, (e->>'quantity')::numeric, (e->>'unit_price')::numeric,
         coalesce(p.cost_price, 0)
  from jsonb_array_elements(_sale->'items') as e
  left join public.products p on p.id = (e->>'product_id')::uuid and p.business_id = v_business_id;

  insert into public.invoices (id, business_id, invoice_number, customer_name, customer_phone,
                               customer_email, notes, status, subtotal, discount_amount, tax, total,
                               sale_id, created_by, issue_date, created_at)
  values (v_invoice_id, v_business_id, _sale->>'invoice_number',
          coalesce(_sale->>'customer_name', 'Walk-in Customer'),
          nullif(_sale->>'customer_phone', ''), nullif(_sale->>'customer_email', ''),
          nullif(_sale->>'notes', ''), 'paid',
          (_sale->>'subtotal')::numeric, (_sale->>'discount')::numeric, v_tax, (_sale->>'total')::numeric,
          v_sale_id, (_sale->>'staff_id')::uuid, (v_created_at)::date, v_created_at);

  insert into public.invoice_items (invoice_id, description, quantity, unit_price, line_total)
  select v_invoice_id, e->>'name', (e->>'quantity')::numeric, (e->>'unit_price')::numeric,
         (e->>'quantity')::numeric * (e->>'unit_price')::numeric
  from jsonb_array_elements(_sale->'items') as e;

  -- Ledger posting: never let it fail the sale.
  begin
    perform public.post_sale_journal(v_business_id, v_sale_id);
  exception when others then
    null;
  end;

  return jsonb_build_object('status', 'committed', 'sale_id', v_sale_id, 'invoice_number', _sale->>'invoice_number');
end;
$$;
revoke all on function public.commit_offline_sale(jsonb) from public, anon;
grant execute on function public.commit_offline_sale(jsonb) to authenticated;

notify pgrst, 'reload schema';

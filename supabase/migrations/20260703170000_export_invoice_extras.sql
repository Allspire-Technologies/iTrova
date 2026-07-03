-- Export-invoice extras (page 2 of the commercial invoice) + inventory depletion.
--   * Exporter profile gains RC number + bank details (reusable, snapshotted per invoice).
--   * export_invoices gains the seller RC/bank snapshot, shipping details, invoice summary
--     (total cartons) and the amount-in-words.
--   * create_export_invoice: one atomic call that deducts stock for product-linked lines
--     (boxes x units_per_box), numbers the invoice, and inserts it — guarding overselling.

-- 1. Exporter profile: RC + bank.
alter table public.businesses
  add column if not exists export_rc_number     text,
  add column if not exists export_bank_name     text,
  add column if not exists export_account_name  text,
  add column if not exists export_account_number text,
  add column if not exists export_swift         text;

-- 2. Snapshot + document fields on the saved invoice.
alter table public.export_invoices
  add column if not exists seller_rc        text,
  add column if not exists total_cartons    numeric not null default 0,
  add column if not exists mode_of_shipment text,
  add column if not exists delivery_terms   text,
  add column if not exists packaging        text,
  add column if not exists payment_terms    text,
  add column if not exists bank_name        text,
  add column if not exists account_name     text,
  add column if not exists account_number   text,
  add column if not exists swift            text,
  add column if not exists amount_in_words  text;

-- 3. Atomic create: deduct stock (boxes x units_per_box) for lines that reference a product, number
--    the invoice, and insert it. Line item shape:
--    { product_id?, description, size, units_per_box, boxes, unit_price, total }
create or replace function public.create_export_invoice(_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := (_data->>'business_id')::uuid;
  v_id          uuid := gen_random_uuid();
  v_number      text;
  v_item        jsonb;
  v_pid         uuid;
  v_qty         numeric;
  v_name        text;
  v_subtotal    numeric := 0;
  v_cartons     numeric := 0;
begin
  if v_business_id is null or v_business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  -- Walk the lines: accumulate totals, and deduct stock for product-linked lines (guard overselling).
  for v_item in select value from jsonb_array_elements(coalesce(_data->'items', '[]'::jsonb)) loop
    v_cartons  := v_cartons  + coalesce((v_item->>'boxes')::numeric, 0);
    v_subtotal := v_subtotal + (coalesce((v_item->>'boxes')::numeric, 0) * coalesce((v_item->>'unit_price')::numeric, 0));

    v_pid := nullif(v_item->>'product_id', '')::uuid;
    if v_pid is not null then
      v_qty := coalesce((v_item->>'boxes')::numeric, 0) * coalesce((v_item->>'units_per_box')::numeric, 0);
      if v_qty > 0 then
        update public.products
          set stock_quantity = stock_quantity - v_qty
          where id = v_pid and business_id = v_business_id and stock_quantity >= v_qty;
        if not found then
          select name into v_name from public.products where id = v_pid and business_id = v_business_id;
          raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'an item') using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end loop;

  v_number := public.next_export_invoice_number(v_business_id);

  insert into public.export_invoices (
    id, business_id, invoice_number, invoice_date, country_of_origin, currency,
    seller_name, seller_address, seller_email, seller_phone, seller_rc,
    buyer_name, buyer_address, buyer_country,
    items, subtotal, total, total_cartons,
    mode_of_shipment, delivery_terms, packaging, payment_terms,
    bank_name, account_name, account_number, swift, amount_in_words, notes, created_by
  ) values (
    v_id, v_business_id, v_number,
    coalesce((_data->>'invoice_date')::date, current_date),
    _data->>'country_of_origin', coalesce(_data->>'currency', 'NGN'),
    _data->>'seller_name', _data->>'seller_address', _data->>'seller_email', _data->>'seller_phone', _data->>'seller_rc',
    _data->>'buyer_name', _data->>'buyer_address', _data->>'buyer_country',
    coalesce(_data->'items', '[]'::jsonb), v_subtotal, v_subtotal, v_cartons,
    _data->>'mode_of_shipment', _data->>'delivery_terms', _data->>'packaging', _data->>'payment_terms',
    _data->>'bank_name', _data->>'account_name', _data->>'account_number', _data->>'swift',
    _data->>'amount_in_words', _data->>'notes', auth.uid()
  );

  return jsonb_build_object('id', v_id, 'invoice_number', v_number, 'total', v_subtotal, 'total_cartons', v_cartons);
end;
$$;

revoke all on function public.create_export_invoice(jsonb) from public, anon;
grant execute on function public.create_export_invoice(jsonb) to authenticated;

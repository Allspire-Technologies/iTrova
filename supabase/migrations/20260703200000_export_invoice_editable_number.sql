-- Make the export invoice number user-editable: create_export_invoice now uses the invoice_number
-- passed from the form when present, and only auto-generates one when it's left blank. The unique
-- (business_id, invoice_number) constraint still guards duplicates (the whole call is one
-- transaction, so a clash rolls back the stock deduction too).
create or replace function public.create_export_invoice(_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := (_data->>'business_id')::uuid;
  v_id          uuid := gen_random_uuid();
  v_number      text := nullif(trim(_data->>'invoice_number'), '');
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

  -- Use the form's number when provided; otherwise auto-assign the next one.
  if v_number is null then
    v_number := public.next_export_invoice_number(v_business_id);
  end if;

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

grant execute on function public.create_export_invoice(jsonb) to authenticated;

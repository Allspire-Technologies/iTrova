-- Edit an already-saved export invoice (owner-only in the UI). Reconciles inventory atomically:
-- reverse the previous lines' depletion, then apply the edited lines (guarding overselling), and
-- update the document. One transaction, so any clash (insufficient stock or a duplicate number)
-- rolls the whole thing back and leaves stock unchanged.
create or replace function public.update_export_invoice(_id uuid, _data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := (_data->>'business_id')::uuid;
  v_number      text := nullif(trim(_data->>'invoice_number'), '');
  v_old         jsonb;
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

  select items into v_old from public.export_invoices where id = _id and business_id = v_business_id;
  if not found then raise exception 'export invoice not found'; end if;

  -- Reverse the previous depletion (add the old quantities back).
  for v_item in select value from jsonb_array_elements(coalesce(v_old, '[]'::jsonb)) loop
    v_pid := nullif(v_item->>'product_id', '')::uuid;
    if v_pid is not null then
      v_qty := coalesce((v_item->>'boxes')::numeric, 0) * coalesce((v_item->>'units_per_box')::numeric, 0);
      if v_qty > 0 then
        update public.products set stock_quantity = stock_quantity + v_qty where id = v_pid and business_id = v_business_id;
      end if;
    end if;
  end loop;

  -- Apply the edited lines (subtract, guarding overselling) + recompute totals.
  for v_item in select value from jsonb_array_elements(coalesce(_data->'items', '[]'::jsonb)) loop
    v_cartons  := v_cartons  + coalesce((v_item->>'boxes')::numeric, 0);
    v_subtotal := v_subtotal + (coalesce((v_item->>'boxes')::numeric, 0) * coalesce((v_item->>'unit_price')::numeric, 0));
    v_pid := nullif(v_item->>'product_id', '')::uuid;
    if v_pid is not null then
      v_qty := coalesce((v_item->>'boxes')::numeric, 0) * coalesce((v_item->>'units_per_box')::numeric, 0);
      if v_qty > 0 then
        update public.products set stock_quantity = stock_quantity - v_qty
          where id = v_pid and business_id = v_business_id and stock_quantity >= v_qty;
        if not found then
          select name into v_name from public.products where id = v_pid and business_id = v_business_id;
          raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'an item') using errcode = 'check_violation';
        end if;
      end if;
    end if;
  end loop;

  if v_number is null then
    v_number := public.next_export_invoice_number(v_business_id);
  end if;

  update public.export_invoices set
    invoice_number    = v_number,
    invoice_date      = coalesce((_data->>'invoice_date')::date, current_date),
    country_of_origin = _data->>'country_of_origin',
    currency          = coalesce(_data->>'currency', 'NGN'),
    seller_name       = _data->>'seller_name',
    seller_address    = _data->>'seller_address',
    seller_email      = _data->>'seller_email',
    seller_phone      = _data->>'seller_phone',
    seller_rc         = _data->>'seller_rc',
    buyer_name        = _data->>'buyer_name',
    buyer_address     = _data->>'buyer_address',
    buyer_country     = _data->>'buyer_country',
    items             = coalesce(_data->'items', '[]'::jsonb),
    subtotal          = v_subtotal,
    total             = v_subtotal,
    total_cartons     = v_cartons,
    mode_of_shipment  = _data->>'mode_of_shipment',
    delivery_terms    = _data->>'delivery_terms',
    packaging         = _data->>'packaging',
    payment_terms     = _data->>'payment_terms',
    bank_name         = _data->>'bank_name',
    account_name      = _data->>'account_name',
    account_number    = _data->>'account_number',
    swift             = _data->>'swift',
    amount_in_words   = _data->>'amount_in_words',
    notes             = _data->>'notes'
  where id = _id and business_id = v_business_id;

  return jsonb_build_object('id', _id, 'invoice_number', v_number, 'total', v_subtotal, 'total_cartons', v_cartons);
end;
$$;

revoke all on function public.update_export_invoice(uuid, jsonb) from public, anon;
grant execute on function public.update_export_invoice(uuid, jsonb) to authenticated;

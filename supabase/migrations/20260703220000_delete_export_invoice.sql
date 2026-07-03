-- Delete a saved export invoice (owner-only in the UI), returning the stock it depleted to
-- inventory. Atomic: restock the product-linked lines, then remove the row.
create or replace function public.delete_export_invoice(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_items       jsonb;
  v_item        jsonb;
  v_pid         uuid;
  v_qty         numeric;
begin
  select business_id, items into v_business_id, v_items from public.export_invoices where id = _id;
  if not found then return; end if;
  if v_business_id is null or v_business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(v_items, '[]'::jsonb)) loop
    v_pid := nullif(v_item->>'product_id', '')::uuid;
    if v_pid is not null then
      v_qty := coalesce((v_item->>'boxes')::numeric, 0) * coalesce((v_item->>'units_per_box')::numeric, 0);
      if v_qty > 0 then
        update public.products set stock_quantity = stock_quantity + v_qty where id = v_pid and business_id = v_business_id;
      end if;
    end if;
  end loop;

  delete from public.export_invoices where id = _id and business_id = v_business_id;
end;
$$;

revoke all on function public.delete_export_invoice(uuid) from public, anon;
grant execute on function public.delete_export_invoice(uuid) to authenticated;

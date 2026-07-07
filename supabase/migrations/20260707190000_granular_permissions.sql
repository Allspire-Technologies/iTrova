-- Register the remaining per-action permissions so every button in the app maps to a grantable
-- permission (Raw Materials link-to-product / reorder / approve / reject; Invoices print+download;
-- Export-invoice download; PO download+csv_import; Team csv_import+csv_export). This migration keeps
-- the server side in step with src/lib/permissions.ts:
--   1. Material-request approval/rejection now assert their own permissions (approve_requests /
--      reject_requests) instead of the blanket adjust_stock — bodies are otherwise unchanged from
--      20260707150000.
--   2. default_role_permissions re-declared so manager keeps every capability it had (the drift
--      guard in permissions.test.ts parses THIS migration now).

-- ============================================================ approve: assert approve_requests
create or replace function public.approve_requisition(_requisition_id uuid, _items jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_req      record;
  v_item     record;
  v_name     text;
  v_override numeric;
  v_qty      numeric;
begin
  select * into v_req from public.production_requisitions where id = _requisition_id for update;
  if not found or v_req.business_id <> public.current_business_id() then
    raise exception 'requisition not found';
  end if;
  perform public.assert_permission(v_req.business_id, 'raw_materials', 'approve_requests');
  if v_req.status <> 'pending' then
    raise exception 'REQUISITION_NOT_PENDING' using errcode = 'check_violation';
  end if;

  for v_item in
    select i.id, i.raw_material_id, i.quantity_requested
    from public.production_requisition_items i
    where i.requisition_id = _requisition_id
    order by i.raw_material_id
  loop
    select (e->>'quantity')::numeric into v_override
    from jsonb_array_elements(coalesce(_items, '[]'::jsonb)) as e
    where (e->>'raw_material_id')::uuid = v_item.raw_material_id
    limit 1;
    v_qty := coalesce(v_override, v_item.quantity_requested);
    if v_qty is null or v_qty <= 0 or v_qty > v_item.quantity_requested then
      raise exception 'APPROVE_QTY_INVALID' using errcode = 'check_violation';
    end if;

    update public.raw_materials
       set stock_quantity = stock_quantity - v_qty
     where id = v_item.raw_material_id and business_id = v_req.business_id
       and stock_quantity >= v_qty;
    if not found then
      select name into v_name from public.raw_materials where id = v_item.raw_material_id;
      raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'a material') using errcode = 'check_violation';
    end if;

    update public.production_requisition_items set quantity_issued = v_qty where id = v_item.id;

    insert into public.stock_adjustments (business_id, raw_material_id, delta, reason, notes, user_id)
    values (v_req.business_id, v_item.raw_material_id, -v_qty, 'Production', 'Requisition approved', auth.uid());
  end loop;

  update public.production_requisitions
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = _requisition_id;

  return jsonb_build_object('id', _requisition_id, 'status', 'approved');
end;
$$;
revoke all on function public.approve_requisition(uuid, jsonb) from public, anon;
grant execute on function public.approve_requisition(uuid, jsonb) to authenticated;

-- ============================================================ reject: assert reject_requests
create or replace function public.reject_requisition(_requisition_id uuid, _reason text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_req record;
begin
  select * into v_req from public.production_requisitions where id = _requisition_id for update;
  if not found or v_req.business_id <> public.current_business_id() then
    raise exception 'requisition not found';
  end if;
  perform public.assert_permission(v_req.business_id, 'raw_materials', 'reject_requests');
  if v_req.status <> 'pending' then
    raise exception 'REQUISITION_NOT_PENDING' using errcode = 'check_violation';
  end if;

  update public.production_requisitions
     set status = 'rejected', decision_note = nullif(_reason, ''),
         approved_by = auth.uid(), approved_at = now()
   where id = _requisition_id;

  return jsonb_build_object('id', _requisition_id, 'status', 'rejected');
end;
$$;
revoke all on function public.reject_requisition(uuid, text) from public, anon;
grant execute on function public.reject_requisition(uuid, text) to authenticated;

-- ============================================================ defaults (mirror permissions.ts)
-- Keep byte-compatible with DEFAULT_ROLE_PERMISSIONS in src/lib/permissions.ts (array order matters).
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
      "reports": ["view","export"]
    }'::jsonb
    when 'cashier' then '{
      "pos": ["view","orders_manage"],
      "invoices": ["view","create","print"]
    }'::jsonb
    else '{}'::jsonb
  end;
$$;
-- RBAC_DEFAULTS_JSON_END

notify pgrst, 'reload schema';

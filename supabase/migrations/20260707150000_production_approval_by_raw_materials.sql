-- Production refinement: approval authority belongs to whoever manages Raw Materials stock.
--
-- The flow is: a Production Manager REQUESTS materials FROM the raw-materials custodian. So
-- approve / reject / cancel-approved are now gated on raw_materials.adjust_stock (the existing
-- stock-movement permission) instead of a production-side action, and the approver may REDUCE
-- requested quantities at approval — the reduced amount is what gets issued and deducted.
-- default_role_permissions drops production.approve accordingly; the drift-guard markers move
-- here from 20260707110000 (src/lib/permissions.test.ts parses THIS file now).

-- ============================================================ approve (new signature: optional
-- per-material overrides). The old 1-arg version is dropped — signature changed.
drop function if exists public.approve_requisition(uuid);

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
  perform public.assert_permission(v_req.business_id, 'raw_materials', 'adjust_stock');
  if v_req.status <> 'pending' then
    raise exception 'REQUISITION_NOT_PENDING' using errcode = 'check_violation';
  end if;

  for v_item in
    select i.id, i.raw_material_id, i.quantity_requested
    from public.production_requisition_items i
    where i.requisition_id = _requisition_id
    order by i.raw_material_id
  loop
    -- Approved quantity = the approver's override when given, else the requested amount.
    -- Overrides may only reduce (0 < qty <= requested).
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

-- ============================================================ reject: guard swap only
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
  perform public.assert_permission(v_req.business_id, 'raw_materials', 'adjust_stock');
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

-- ============================================================ cancel: guard swap only
-- (requester cancels own pending with production.request; the custodian cancels anything
-- cancellable — cancelling an approved request restocks what was issued.)
create or replace function public.cancel_requisition(_requisition_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_req  record;
  v_item record;
begin
  select * into v_req from public.production_requisitions where id = _requisition_id for update;
  if not found or v_req.business_id <> public.current_business_id() then
    raise exception 'requisition not found';
  end if;

  if v_req.status = 'pending' then
    if v_req.requested_by = auth.uid() then
      perform public.assert_permission(v_req.business_id, 'production', 'request');
    else
      perform public.assert_permission(v_req.business_id, 'raw_materials', 'adjust_stock');
    end if;
  elsif v_req.status = 'approved' then
    perform public.assert_permission(v_req.business_id, 'raw_materials', 'adjust_stock');
    for v_item in
      select i.raw_material_id, i.quantity_issued
      from public.production_requisition_items i
      where i.requisition_id = _requisition_id and coalesce(i.quantity_issued, 0) > 0
      order by i.raw_material_id
    loop
      update public.raw_materials
         set stock_quantity = stock_quantity + v_item.quantity_issued
       where id = v_item.raw_material_id and business_id = v_req.business_id;
      insert into public.stock_adjustments (business_id, raw_material_id, delta, reason, notes, user_id)
      values (v_req.business_id, v_item.raw_material_id, v_item.quantity_issued,
              'Production', 'Requisition cancelled', auth.uid());
    end loop;
  else
    raise exception 'REQUISITION_NOT_CANCELLABLE' using errcode = 'check_violation';
  end if;

  update public.production_requisitions
     set status = 'cancelled', approved_by = auth.uid(), approved_at = now()
   where id = _requisition_id;

  return jsonb_build_object('id', _requisition_id, 'status', 'cancelled');
end;
$$;
revoke all on function public.cancel_requisition(uuid) from public, anon;
grant execute on function public.cancel_requisition(uuid) to authenticated;

-- ============================================================ defaults: drop production.approve
-- Keep this JSON byte-identical in spirit to DEFAULT_ROLE_PERMISSIONS in src/lib/permissions.ts.
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
      "raw_materials": ["view","create","edit","record_purchase","adjust_stock","csv_import","csv_export"],
      "invoices": ["view","create","edit","status_change","record_payment","delete","csv_export"],
      "export_invoices": ["view","create"],
      "purchase_orders": ["view","create","status_change","receive","delete","csv_export"],
      "general_store": ["view","item_manage","staff_manage","checkout","return","csv_import"],
      "production": ["view","recipes_manage","request","produce"],
      "reports": ["view","export"]
    }'::jsonb
    when 'cashier' then '{
      "pos": ["view","orders_manage"],
      "invoices": ["view","create"]
    }'::jsonb
    else '{}'::jsonb
  end;
$$;
-- RBAC_DEFAULTS_JSON_END

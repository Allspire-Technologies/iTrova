-- Ensure the requester edit/delete RPCs exist. These were added to 20260707100000 after that
-- migration had already been applied to some databases, so re-running 100000 is skipped and the
-- functions are missing ("Could not find the function public.update_requisition/... in the schema
-- cache"). This idempotent CREATE OR REPLACE brings any database up to date, and the final NOTIFY
-- refreshes PostgREST's function cache so the new RPCs are callable immediately.

-- Requester edits their own PENDING request: replaces the material lines + notes.
create or replace function public.update_requisition(_requisition_id uuid, _items jsonb, _notes text)
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
  perform public.assert_permission(v_req.business_id, 'production', 'request');
  if v_req.requested_by is distinct from auth.uid() then
    raise exception 'NOT_YOUR_REQUEST' using errcode = 'check_violation';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'REQUISITION_NOT_PENDING' using errcode = 'check_violation';
  end if;

  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    raise exception 'EMPTY_ITEMS' using errcode = 'check_violation';
  end if;

  delete from public.production_requisition_items where requisition_id = _requisition_id;
  for v_item in
    select (e->>'raw_material_id')::uuid as raw_material_id, (e->>'quantity')::numeric as qty
    from jsonb_array_elements(_items) as e
  loop
    if v_item.qty is null or v_item.qty <= 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.raw_materials rm
                   where rm.id = v_item.raw_material_id and rm.business_id = v_req.business_id) then
      raise exception 'MATERIAL_NOT_FOUND' using errcode = 'check_violation';
    end if;
    insert into public.production_requisition_items (requisition_id, raw_material_id, quantity_requested)
    values (_requisition_id, v_item.raw_material_id, v_item.qty);
  end loop;

  update public.production_requisitions set notes = nullif(_notes, '') where id = _requisition_id;
  return jsonb_build_object('id', _requisition_id, 'status', 'pending');
end;
$$;
revoke all on function public.update_requisition(uuid, jsonb, text) from public, anon;
grant execute on function public.update_requisition(uuid, jsonb, text) to authenticated;

-- Requester deletes their own PENDING request outright (no stock was moved yet).
create or replace function public.delete_requisition(_requisition_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_req record;
begin
  select * into v_req from public.production_requisitions where id = _requisition_id for update;
  if not found or v_req.business_id <> public.current_business_id() then
    raise exception 'requisition not found';
  end if;
  perform public.assert_permission(v_req.business_id, 'production', 'request');
  if v_req.requested_by is distinct from auth.uid() then
    raise exception 'NOT_YOUR_REQUEST' using errcode = 'check_violation';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'REQUISITION_NOT_PENDING' using errcode = 'check_violation';
  end if;
  delete from public.production_requisitions where id = _requisition_id; -- items cascade
end;
$$;
revoke all on function public.delete_requisition(uuid) from public, anon;
grant execute on function public.delete_requisition(uuid) to authenticated;

-- Tell PostgREST to reload its schema cache so the RPCs resolve without a restart.
notify pgrst, 'reload schema';

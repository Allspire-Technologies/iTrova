-- Production module: material requisitions + production runs.
--
-- The manufacturing loop the module implements:
--   recipes (product_materials, which finally gets a UI) describe what a product is made of;
--   a requester raises a requisition for raw materials → an approver approves it, which ISSUES
--   the materials (guarded stock deduction); → a production run records what those materials
--   produced, incrementing product stock and auto-restocking any unused issued material.
--   Runs can also be recorded directly (no requisition) for small teams.
--
-- All writes go through SECURITY DEFINER RPCs below — the tables carry SELECT-only policies and
-- SELECT-only grants, so the RPCs are the only mutation path (anti-tamper). Every stock movement
-- writes a stock_adjustments audit row (reason 'Production'), mirroring receive_purchase_order.

-- ============================== Tables ==============================

create table if not exists public.production_requisitions (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  requested_by  uuid,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected','cancelled','completed')),
  notes         text,
  decision_note text,
  approved_by   uuid,
  approved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists production_requisitions_business_created_idx
  on public.production_requisitions (business_id, created_at desc);

create table if not exists public.production_requisition_items (
  id                 uuid primary key default gen_random_uuid(),
  requisition_id     uuid not null references public.production_requisitions(id) on delete cascade,
  raw_material_id    uuid not null references public.raw_materials(id) on delete cascade,
  quantity_requested numeric not null check (quantity_requested > 0),
  quantity_issued    numeric
);
create index if not exists production_requisition_items_requisition_idx
  on public.production_requisition_items (requisition_id);

create table if not exists public.production_runs (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  requisition_id uuid references public.production_requisitions(id) on delete set null,
  produced_by    uuid,
  notes          text,
  created_at     timestamptz not null default now()
);
create index if not exists production_runs_business_created_idx
  on public.production_runs (business_id, created_at desc);

create table if not exists public.production_run_outputs (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.production_runs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity   numeric not null check (quantity > 0)
);
create index if not exists production_run_outputs_run_idx on public.production_run_outputs (run_id);

create table if not exists public.production_run_materials (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.production_runs(id) on delete cascade,
  raw_material_id uuid not null references public.raw_materials(id) on delete cascade,
  quantity_used   numeric not null check (quantity_used >= 0)
);
create index if not exists production_run_materials_run_idx on public.production_run_materials (run_id);

-- ============================== RLS: read-only ==============================
-- SELECT for business members only; NO write policies and no write grants — mutations happen
-- exclusively inside the definer RPCs.

alter table public.production_requisitions      enable row level security;
alter table public.production_requisition_items enable row level security;
alter table public.production_runs              enable row level security;
alter table public.production_run_outputs       enable row level security;
alter table public.production_run_materials     enable row level security;

create policy "biz members view production_requisitions" on public.production_requisitions
  for select using (business_id = public.current_business_id());
create policy "biz members view production_requisition_items" on public.production_requisition_items
  for select using (exists (
    select 1 from public.production_requisitions r
    where r.id = production_requisition_items.requisition_id
      and r.business_id = public.current_business_id()
  ));
create policy "biz members view production_runs" on public.production_runs
  for select using (business_id = public.current_business_id());
create policy "biz members view production_run_outputs" on public.production_run_outputs
  for select using (exists (
    select 1 from public.production_runs r
    where r.id = production_run_outputs.run_id and r.business_id = public.current_business_id()
  ));
create policy "biz members view production_run_materials" on public.production_run_materials
  for select using (exists (
    select 1 from public.production_runs r
    where r.id = production_run_materials.run_id and r.business_id = public.current_business_id()
  ));

grant select on public.production_requisitions      to authenticated;
grant select on public.production_requisition_items to authenticated;
grant select on public.production_runs              to authenticated;
grant select on public.production_run_outputs       to authenticated;
grant select on public.production_run_materials     to authenticated;
grant all on public.production_requisitions      to service_role;
grant all on public.production_requisition_items to service_role;
grant all on public.production_runs              to service_role;
grant all on public.production_run_outputs       to service_role;
grant all on public.production_run_materials     to service_role;

-- ============================== RPCs ==============================

-- Raise a requisition: header + validated material lines. No stock movement yet.
create or replace function public.create_requisition(_business_id uuid, _items jsonb, _notes text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_id   uuid := gen_random_uuid();
  v_item record;
  v_n    int := 0;
begin
  if _business_id is null or _business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;
  perform public.assert_permission(_business_id, 'production', 'request');

  if _items is null or jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    raise exception 'EMPTY_ITEMS' using errcode = 'check_violation';
  end if;

  insert into public.production_requisitions (id, business_id, requested_by, notes)
  values (v_id, _business_id, auth.uid(), nullif(_notes, ''));

  for v_item in
    select (e->>'raw_material_id')::uuid as raw_material_id, (e->>'quantity')::numeric as qty
    from jsonb_array_elements(_items) as e
  loop
    if v_item.qty is null or v_item.qty <= 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'check_violation';
    end if;
    -- Re-validate ownership: ids arrive in JSON, so a foreign id must not slip through.
    if not exists (select 1 from public.raw_materials rm
                   where rm.id = v_item.raw_material_id and rm.business_id = _business_id) then
      raise exception 'MATERIAL_NOT_FOUND' using errcode = 'check_violation';
    end if;
    insert into public.production_requisition_items (requisition_id, raw_material_id, quantity_requested)
    values (v_id, v_item.raw_material_id, v_item.qty);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('id', v_id, 'status', 'pending', 'items', v_n);
end;
$$;
revoke all on function public.create_requisition(uuid, jsonb, text) from public, anon;
grant execute on function public.create_requisition(uuid, jsonb, text) to authenticated;

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

-- Requester deletes their own PENDING request outright (no stock was moved yet). Approvers keep
-- reject/cancel for requests that aren't theirs or are already approved.
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

-- Approve = issue: atomically deduct every requested quantity (oversell-guarded) and stamp the
-- decision. The whole transaction rolls back on the first shortfall.
create or replace function public.approve_requisition(_requisition_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_req  record;
  v_item record;
  v_name text;
begin
  select * into v_req from public.production_requisitions where id = _requisition_id for update;
  if not found or v_req.business_id <> public.current_business_id() then
    raise exception 'requisition not found';
  end if;
  perform public.assert_permission(v_req.business_id, 'production', 'approve');
  if v_req.status <> 'pending' then
    raise exception 'REQUISITION_NOT_PENDING' using errcode = 'check_violation';
  end if;

  -- Stable ordering avoids deadlocks when two approvals touch overlapping materials.
  for v_item in
    select i.id, i.raw_material_id, i.quantity_requested
    from public.production_requisition_items i
    where i.requisition_id = _requisition_id
    order by i.raw_material_id
  loop
    update public.raw_materials
       set stock_quantity = stock_quantity - v_item.quantity_requested
     where id = v_item.raw_material_id and business_id = v_req.business_id
       and stock_quantity >= v_item.quantity_requested;
    if not found then
      select name into v_name from public.raw_materials where id = v_item.raw_material_id;
      raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'a material') using errcode = 'check_violation';
    end if;

    update public.production_requisition_items
       set quantity_issued = v_item.quantity_requested where id = v_item.id;

    insert into public.stock_adjustments (business_id, raw_material_id, delta, reason, notes, user_id)
    values (v_req.business_id, v_item.raw_material_id, -v_item.quantity_requested,
            'Production', 'Requisition approved', auth.uid());
  end loop;

  update public.production_requisitions
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = _requisition_id;

  return jsonb_build_object('id', _requisition_id, 'status', 'approved');
end;
$$;
revoke all on function public.approve_requisition(uuid) from public, anon;
grant execute on function public.approve_requisition(uuid) to authenticated;

-- Reject a pending requisition. No stock movement.
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
  perform public.assert_permission(v_req.business_id, 'production', 'approve');
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

-- Cancel: a requester may cancel their own PENDING request; an approver may cancel pending or
-- APPROVED ones — cancelling an approved requisition restocks everything that was issued, so
-- approved-but-never-produced stock is never stranded.
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
      perform public.assert_permission(v_req.business_id, 'production', 'approve');
    end if;
  elsif v_req.status = 'approved' then
    perform public.assert_permission(v_req.business_id, 'production', 'approve');
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

-- Record a production run. Two modes:
--   direct (_requisition_id null): each material line is a fresh, guarded deduction;
--   from an APPROVED requisition: reconcile per material with delta = used − issued
--     (extra usage deducts with the guard, unused remainder restocks), then mark it completed.
-- Outputs always increment product stock. Every movement gets a stock_adjustments row.
create or replace function public.record_production_run(
  _business_id uuid, _requisition_id uuid, _outputs jsonb, _materials jsonb, _notes text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run_id uuid := gen_random_uuid();
  v_req    record;
  v_out    record;
  v_mat    record;
  v_line   record;
  v_name   text;
  v_issued numeric;
  v_delta  numeric;
begin
  if _business_id is null or _business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;
  perform public.assert_permission(_business_id, 'production', 'produce');

  if _outputs is null or jsonb_typeof(_outputs) <> 'array' or jsonb_array_length(_outputs) = 0 then
    raise exception 'EMPTY_OUTPUTS' using errcode = 'check_violation';
  end if;

  if _requisition_id is not null then
    select * into v_req from public.production_requisitions where id = _requisition_id for update;
    if not found or v_req.business_id <> _business_id then
      raise exception 'requisition not found';
    end if;
    if v_req.status <> 'approved' then
      raise exception 'REQUISITION_NOT_APPROVED' using errcode = 'check_violation';
    end if;
  end if;

  insert into public.production_runs (id, business_id, requisition_id, produced_by, notes)
  values (v_run_id, _business_id, _requisition_id, auth.uid(), nullif(_notes, ''));

  -- Materials: build the used-per-material map from the payload (validated + summed per id).
  create temp table _run_used (raw_material_id uuid primary key, used numeric) on commit drop;
  for v_mat in
    select (e->>'raw_material_id')::uuid as raw_material_id, (e->>'quantity_used')::numeric as used
    from jsonb_array_elements(coalesce(_materials, '[]'::jsonb)) as e
  loop
    if v_mat.used is null or v_mat.used < 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.raw_materials rm
                   where rm.id = v_mat.raw_material_id and rm.business_id = _business_id) then
      raise exception 'MATERIAL_NOT_FOUND' using errcode = 'check_violation';
    end if;
    insert into _run_used values (v_mat.raw_material_id, v_mat.used)
    on conflict (raw_material_id) do update set used = _run_used.used + excluded.used;
  end loop;

  -- Reconcile stock: union of used materials and (in requisition mode) issued materials, so
  -- issued-but-omitted lines fully restock and extra materials deduct with the guard.
  for v_line in
    select coalesce(u.raw_material_id, i.raw_material_id) as raw_material_id,
           coalesce(u.used, 0) as used,
           coalesce(i.issued, 0) as issued
    from _run_used u
    full outer join (
      select raw_material_id, sum(coalesce(quantity_issued, 0)) as issued
      from public.production_requisition_items
      where _requisition_id is not null and requisition_id = _requisition_id
      group by raw_material_id
    ) i on i.raw_material_id = u.raw_material_id
    order by 1
  loop
    v_delta := v_line.used - v_line.issued;  -- positive = extra to deduct, negative = restock
    if v_delta > 0 then
      update public.raw_materials
         set stock_quantity = stock_quantity - v_delta
       where id = v_line.raw_material_id and business_id = _business_id
         and stock_quantity >= v_delta;
      if not found then
        select name into v_name from public.raw_materials where id = v_line.raw_material_id;
        raise exception 'INSUFFICIENT_STOCK:%', coalesce(v_name, 'a material') using errcode = 'check_violation';
      end if;
      insert into public.stock_adjustments (business_id, raw_material_id, delta, reason, notes, user_id)
      values (_business_id, v_line.raw_material_id, -v_delta, 'Production', 'Production run', auth.uid());
    elsif v_delta < 0 then
      update public.raw_materials
         set stock_quantity = stock_quantity - v_delta   -- minus a negative = restock
       where id = v_line.raw_material_id and business_id = _business_id;
      insert into public.stock_adjustments (business_id, raw_material_id, delta, reason, notes, user_id)
      values (_business_id, v_line.raw_material_id, -v_delta, 'Production', 'Unused material returned', auth.uid());
    end if;

    if v_line.used > 0 then
      insert into public.production_run_materials (run_id, raw_material_id, quantity_used)
      values (v_run_id, v_line.raw_material_id, v_line.used);
    end if;
  end loop;

  -- Outputs: increment product stock + audit rows.
  for v_out in
    select (e->>'product_id')::uuid as product_id, (e->>'quantity')::numeric as qty
    from jsonb_array_elements(_outputs) as e
  loop
    if v_out.qty is null or v_out.qty <= 0 then
      raise exception 'BAD_QUANTITY' using errcode = 'check_violation';
    end if;
    update public.products set stock_quantity = stock_quantity + v_out.qty
     where id = v_out.product_id and business_id = _business_id;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'check_violation';
    end if;
    insert into public.production_run_outputs (run_id, product_id, quantity)
    values (v_run_id, v_out.product_id, v_out.qty);
    insert into public.stock_adjustments (business_id, product_id, delta, reason, notes, user_id)
    values (_business_id, v_out.product_id, v_out.qty, 'Production', 'Production run output', auth.uid());
  end loop;

  if _requisition_id is not null then
    update public.production_requisitions set status = 'completed' where id = _requisition_id;
  end if;

  return jsonb_build_object('id', v_run_id);
end;
$$;
revoke all on function public.record_production_run(uuid, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.record_production_run(uuid, uuid, jsonb, jsonb, text) to authenticated;

-- Register the module in the catalogue. Enable it per plan by adding 'production' to that plan's
-- plans.modules array in Supabase (same as general_store / export_invoices).
insert into public.app_modules (key, label, path, sort_order)
values ('production', 'Production', '/production', 17)
on conflict (key) do nothing;

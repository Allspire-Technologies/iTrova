-- General Store: an internal store of tools/materials, separate from the sales Inventory. A
-- lightweight non-login staff registry borrows borrowable items (must return) or collects consumable
-- items (permanent). store_items.stock_quantity = what's currently available in the store; borrow and
-- collect deduct it, returns add it back.

-- 1. Staff registry (non-login employees).
create table if not exists public.store_staff (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null,
  phone       text,
  role        text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 2. Store inventory (typed items).
create table if not exists public.store_items (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  name           text not null,
  category       text,
  unit           text default 'pcs',
  kind           text not null default 'consumable' check (kind in ('borrowable','consumable')),
  stock_quantity numeric not null default 0,
  reorder_level  numeric not null default 0,
  created_at     timestamptz not null default now()
);

-- 3. Borrow/collect ledger.
create table if not exists public.store_transactions (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  item_id           uuid not null references public.store_items(id) on delete cascade,
  staff_id          uuid references public.store_staff(id) on delete set null,
  kind              text not null check (kind in ('borrow','collect')),
  quantity          numeric not null,
  returned_quantity numeric not null default 0,
  status            text not null default 'out' check (status in ('out','partially_returned','returned','collected')),
  due_date          date,
  returned_at       timestamptz,
  notes             text,
  user_id           uuid,
  created_at        timestamptz not null default now()
);
create index if not exists store_transactions_business_created_idx on public.store_transactions (business_id, created_at desc);

-- RLS + grants (business-scoped, standard 4 policies each).
alter table public.store_staff        enable row level security;
alter table public.store_items        enable row level security;
alter table public.store_transactions enable row level security;

create policy "biz members view store_staff"   on public.store_staff for select using (business_id = public.current_business_id());
create policy "biz members insert store_staff"  on public.store_staff for insert with check (business_id = public.current_business_id());
create policy "biz members update store_staff"  on public.store_staff for update using (business_id = public.current_business_id());
create policy "biz members delete store_staff"  on public.store_staff for delete using (business_id = public.current_business_id());

create policy "biz members view store_items"    on public.store_items for select using (business_id = public.current_business_id());
create policy "biz members insert store_items"   on public.store_items for insert with check (business_id = public.current_business_id());
create policy "biz members update store_items"   on public.store_items for update using (business_id = public.current_business_id());
create policy "biz members delete store_items"   on public.store_items for delete using (business_id = public.current_business_id());

create policy "biz members view store_transactions"   on public.store_transactions for select using (business_id = public.current_business_id());
create policy "biz members insert store_transactions"  on public.store_transactions for insert with check (business_id = public.current_business_id());
create policy "biz members update store_transactions"  on public.store_transactions for update using (business_id = public.current_business_id());
create policy "biz members delete store_transactions"  on public.store_transactions for delete using (business_id = public.current_business_id());

grant select, insert, update, delete on public.store_staff        to authenticated;
grant select, insert, update, delete on public.store_items        to authenticated;
grant select, insert, update, delete on public.store_transactions to authenticated;
grant all on public.store_staff        to service_role;
grant all on public.store_items        to service_role;
grant all on public.store_transactions to service_role;

-- RPC: record a borrow/collect — validate the item's kind matches the action, deduct stock
-- (guarded), and write the ledger row. One transaction, so a clash rolls back the deduction.
create or replace function public.store_checkout(
  _business_id uuid, _item_id uuid, _staff_id uuid, _kind text, _quantity numeric, _due_date date, _notes text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_item_kind text;
  v_name      text;
  v_id        uuid := gen_random_uuid();
  v_status    text;
begin
  if _business_id is null or _business_id <> public.current_business_id() then
    raise exception 'not authorised for this business';
  end if;
  if _kind not in ('borrow', 'collect') then raise exception 'invalid kind'; end if;
  if _quantity is null or _quantity <= 0 then raise exception 'quantity must be positive'; end if;

  select kind, name into v_item_kind, v_name from public.store_items where id = _item_id and business_id = _business_id;
  if not found then raise exception 'store item not found'; end if;

  if _kind = 'borrow' and v_item_kind <> 'borrowable' then raise exception 'WRONG_KIND:%', v_name using errcode = 'check_violation'; end if;
  if _kind = 'collect' and v_item_kind <> 'consumable' then raise exception 'WRONG_KIND:%', v_name using errcode = 'check_violation'; end if;

  update public.store_items set stock_quantity = stock_quantity - _quantity
    where id = _item_id and business_id = _business_id and stock_quantity >= _quantity;
  if not found then raise exception 'INSUFFICIENT_STOCK:%', v_name using errcode = 'check_violation'; end if;

  v_status := case when _kind = 'borrow' then 'out' else 'collected' end;
  insert into public.store_transactions (id, business_id, item_id, staff_id, kind, quantity, status, due_date, notes, user_id)
  values (v_id, _business_id, _item_id, _staff_id, _kind, _quantity, v_status,
          case when _kind = 'borrow' then _due_date else null end, nullif(_notes, ''), auth.uid());

  return jsonb_build_object('id', v_id, 'status', v_status);
end;
$$;
revoke all on function public.store_checkout(uuid, uuid, uuid, text, numeric, date, text) from public, anon;
grant execute on function public.store_checkout(uuid, uuid, uuid, text, numeric, date, text) to authenticated;

-- RPC: return some (or all) of a borrow — restock the item and advance the record's status.
create or replace function public.store_return(_transaction_id uuid, _quantity numeric)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_txn         record;
  v_outstanding numeric;
  v_status      text;
begin
  select * into v_txn from public.store_transactions where id = _transaction_id;
  if not found then raise exception 'transaction not found'; end if;
  if v_txn.business_id <> public.current_business_id() then raise exception 'not authorised for this business'; end if;
  if v_txn.kind <> 'borrow' then raise exception 'only borrowed items can be returned'; end if;
  if v_txn.status not in ('out', 'partially_returned') then raise exception 'nothing outstanding to return'; end if;
  if _quantity is null or _quantity <= 0 then raise exception 'quantity must be positive'; end if;

  v_outstanding := v_txn.quantity - v_txn.returned_quantity;
  if _quantity > v_outstanding then raise exception 'RETURN_TOO_MUCH:%', v_outstanding using errcode = 'check_violation'; end if;

  update public.store_items set stock_quantity = stock_quantity + _quantity
    where id = v_txn.item_id and business_id = v_txn.business_id;

  v_status := case when (v_txn.returned_quantity + _quantity) >= v_txn.quantity then 'returned' else 'partially_returned' end;
  update public.store_transactions
    set returned_quantity = returned_quantity + _quantity, status = v_status, returned_at = now()
    where id = _transaction_id;

  return jsonb_build_object('id', _transaction_id, 'status', v_status, 'returned_quantity', v_txn.returned_quantity + _quantity);
end;
$$;
revoke all on function public.store_return(uuid, numeric) from public, anon;
grant execute on function public.store_return(uuid, numeric) to authenticated;

-- Register the module in the catalogue. Enable it per plan by adding 'general_store' to that plan's
-- plans.modules array in Supabase (same as export_invoices).
insert into public.app_modules (key, label, path, sort_order) values
  ('general_store', 'General Store', '/general-store', 16)
on conflict (key) do nothing;

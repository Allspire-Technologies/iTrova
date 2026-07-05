-- RBAC v2 — completes Permissions & Access:
--   A. Server-side permission resolution (default_role_permissions / has_permission / assert_permission)
--      mirroring the client's resolvePermissions. Defaults JSON is drift-guarded by a unit test that
--      parses this file and compares it to src/lib/permissions.ts.
--   B. Trigger hardening: two bookkeeping triggers become SECURITY DEFINER so per-action RLS on the
--      tables they touch can't break checkout/order flows.
--   C. Invite-time role picker: invitations.team_role_id; accept_invitation seeds member_access.
--      remove_member is now permission-gated (team.remove) instead of owner-only.
--   D. Permission guards on the sensitive RPCs (rename to *_impl + thin permission-checked wrappers —
--      no body duplication; the impls keep their own business checks as defense in depth).
--   E. Per-action RLS write policies on the module tables.
--   F. Realtime on team_roles/member_access so permission changes push live.

-- ============================================================ A. resolution functions
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

-- Effective permission check for the CALLER in a business. Mirrors the client:
-- owner -> true; else override ?? assigned role ?? edited system default ?? code defaults.
create or replace function public.has_permission(_business_id uuid, _module text, _action text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  r     public.app_role;
  ma    record;
  m     jsonb;
begin
  if uid is null or _business_id is null then return false; end if;
  if _business_id <> public.current_business_id() then return false; end if;

  r := public.user_business_role(uid, _business_id);
  if r is null then return false; end if;
  if r = 'owner' then return true; end if;

  select permissions, team_role_id into ma
    from public.member_access where user_id = uid and business_id = _business_id;

  if ma.permissions is not null then
    m := ma.permissions;
  elsif ma.team_role_id is not null then
    select permissions into m from public.team_roles where id = ma.team_role_id;
  end if;
  if m is null then
    select permissions into m from public.team_roles where business_id = _business_id and system_key = r;
  end if;
  if m is null then
    m := public.default_role_permissions(r);
  end if;

  return coalesce((m -> _module) ? _action, false);
end;
$$;
revoke all on function public.has_permission(uuid, text, text) from public, anon;
grant execute on function public.has_permission(uuid, text, text) to authenticated;

-- Raise a typed error the client maps to a friendly toast.
create or replace function public.assert_permission(_business_id uuid, _module text, _action text)
returns void
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_permission(_business_id, _module, _action) then
    raise exception 'PERMISSION_DENIED:%.%', _module, _action using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function public.assert_permission(uuid, text, text) from public, anon;
grant execute on function public.assert_permission(uuid, text, text) to authenticated;

-- ============================================================ B. trigger hardening
-- These bookkeeping triggers ran with invoker rights; under per-action RLS a cashier's checkout
-- (sale_items insert -> raw material deduction; sales insert -> auto invoice) would fail. They are
-- internal logic — make them definer like their siblings (deduct_stock_on_ship etc. already are).
alter function public.deduct_raw_on_sale_item() security definer set search_path = public;
alter function public.create_invoice_from_sale() security definer set search_path = public;

-- ============================================================ C. invite-time role picker
alter table public.invitations
  add column if not exists team_role_id uuid references public.team_roles(id) on delete set null;

create or replace function public.accept_invitation(_token text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  inv public.invitations%rowtype;
  uid uuid := auth.uid();
  user_email text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select email into user_email from auth.users where id = uid;

  select * into inv from public.invitations where token = _token;
  if inv.id is null then raise exception 'Invitation not found'; end if;
  if inv.accepted_at is not null then raise exception 'Invitation already used'; end if;
  if inv.expires_at < now() then raise exception 'Invitation expired'; end if;
  if lower(inv.email) <> lower(coalesce(user_email, '')) then
    raise exception 'Invitation email does not match your account';
  end if;

  -- One account belongs to one business. If this account is already attached to a different
  -- business (its own, or one it was invited to), block — the person must use a different email.
  if exists (select 1 from public.profiles   where id = uid       and business_id is not null and business_id <> inv.business_id)
  or exists (select 1 from public.user_roles where user_id = uid  and business_id <> inv.business_id)
  or exists (select 1 from public.businesses where owner_id = uid and id <> inv.business_id) then
    raise exception 'This account already belongs to another business. Use a different email to accept this invite.';
  end if;

  insert into public.user_roles (user_id, business_id, role)
  values (uid, inv.business_id, inv.role)
  on conflict do nothing;

  insert into public.profiles (id, business_id, owner_name)
  values (
    uid,
    inv.business_id,
    coalesce((select owner_name from public.profiles where id = uid), initcap(split_part(coalesce(user_email, 'Member'), '@', 1)))
  )
  on conflict (id) do update
    set business_id = excluded.business_id,
        owner_name  = coalesce(public.profiles.owner_name, excluded.owner_name);

  -- Invite-time role: land the member with the chosen custom role already assigned.
  if inv.team_role_id is not null then
    insert into public.member_access (user_id, business_id, team_role_id, permissions)
    values (uid, inv.business_id, inv.team_role_id, null)
    on conflict (user_id, business_id) do update set team_role_id = excluded.team_role_id;
  end if;

  update public.invitations
  set accepted_at = now(), accepted_by = uid
  where id = inv.id;

  return inv.business_id;
end;
$$;

-- remove_member: was owner-only; now permission-gated (owner always passes has_permission).
create or replace function public.remove_member(_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  biz uuid := public.current_business_id();
begin
  if biz is null then raise exception 'No active business'; end if;
  perform public.assert_permission(biz, 'team', 'remove');
  if _user_id = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  if public.has_business_role(biz, _user_id, 'owner') then
    raise exception 'You cannot remove another owner';
  end if;

  delete from public.user_roles where user_id = _user_id and business_id = biz;
  delete from public.member_access where user_id = _user_id and business_id = biz;
  update public.profiles set business_id = null where id = _user_id and business_id = biz;
end;
$$;

-- ============================================================ D. RPC permission guards
-- Rename each sensitive RPC to *_impl (revoked from clients) and expose a thin wrapper that
-- asserts the permission first. Impl bodies are untouched — their business checks remain.
do $$ begin
  alter function public.delete_invoice(uuid) rename to delete_invoice_impl;
  alter function public.delete_order(uuid) rename to delete_order_impl;
  alter function public.deliver_order(uuid) rename to deliver_order_impl;
  alter function public.create_export_invoice(jsonb) rename to create_export_invoice_impl;
  alter function public.update_export_invoice(uuid, jsonb) rename to update_export_invoice_impl;
  alter function public.delete_export_invoice(uuid) rename to delete_export_invoice_impl;
  alter function public.store_checkout(uuid, uuid, uuid, text, numeric, date, text) rename to store_checkout_impl;
  alter function public.store_return(uuid, numeric) rename to store_return_impl;
  alter function public.record_invoice_payment(uuid, uuid, numeric, text, text) rename to record_invoice_payment_impl;
  alter function public.delete_invoice_payment(uuid) rename to delete_invoice_payment_impl;
exception when undefined_function then
  raise notice 'some RPCs already renamed — continuing';
end $$;

revoke all on function public.delete_invoice_impl(uuid) from public, anon, authenticated;
revoke all on function public.delete_order_impl(uuid) from public, anon, authenticated;
revoke all on function public.deliver_order_impl(uuid) from public, anon, authenticated;
revoke all on function public.create_export_invoice_impl(jsonb) from public, anon, authenticated;
revoke all on function public.update_export_invoice_impl(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.delete_export_invoice_impl(uuid) from public, anon, authenticated;
revoke all on function public.store_checkout_impl(uuid, uuid, uuid, text, numeric, date, text) from public, anon, authenticated;
revoke all on function public.store_return_impl(uuid, numeric) from public, anon, authenticated;
revoke all on function public.record_invoice_payment_impl(uuid, uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function public.delete_invoice_payment_impl(uuid) from public, anon, authenticated;

create or replace function public.delete_invoice(_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_permission(public.current_business_id(), 'invoices', 'delete');
  perform public.delete_invoice_impl(_invoice_id);
end; $$;

create or replace function public.delete_order(_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_permission(public.current_business_id(), 'pos', 'orders_delete');
  perform public.delete_order_impl(_order_id);
end; $$;

create or replace function public.deliver_order(_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_permission(public.current_business_id(), 'pos', 'orders_manage');
  return public.deliver_order_impl(_order_id);
end; $$;

create or replace function public.create_export_invoice(_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_permission(public.current_business_id(), 'export_invoices', 'create');
  return public.create_export_invoice_impl(_data);
end; $$;

create or replace function public.update_export_invoice(_id uuid, _data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_permission(public.current_business_id(), 'export_invoices', 'edit');
  return public.update_export_invoice_impl(_id, _data);
end; $$;

create or replace function public.delete_export_invoice(_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_permission(public.current_business_id(), 'export_invoices', 'delete');
  perform public.delete_export_invoice_impl(_id);
end; $$;

create or replace function public.store_checkout(
  _business_id uuid, _item_id uuid, _staff_id uuid, _kind text, _quantity numeric, _due_date date, _notes text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_permission(_business_id, 'general_store', 'checkout');
  return public.store_checkout_impl(_business_id, _item_id, _staff_id, _kind, _quantity, _due_date, _notes);
end; $$;

create or replace function public.store_return(_transaction_id uuid, _quantity numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_permission(public.current_business_id(), 'general_store', 'return');
  return public.store_return_impl(_transaction_id, _quantity);
end; $$;

create or replace function public.record_invoice_payment(
  _payment_id uuid, _invoice_id uuid, _amount numeric, _method text, _note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_permission(public.current_business_id(), 'invoices', 'record_payment');
  return public.record_invoice_payment_impl(_payment_id, _invoice_id, _amount, _method, _note);
end; $$;

create or replace function public.delete_invoice_payment(_payment_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_permission(public.current_business_id(), 'invoices', 'record_payment');
  return public.delete_invoice_payment_impl(_payment_id);
end; $$;

revoke all on function public.delete_invoice(uuid) from public, anon;
revoke all on function public.delete_order(uuid) from public, anon;
revoke all on function public.deliver_order(uuid) from public, anon;
revoke all on function public.create_export_invoice(jsonb) from public, anon;
revoke all on function public.update_export_invoice(uuid, jsonb) from public, anon;
revoke all on function public.delete_export_invoice(uuid) from public, anon;
revoke all on function public.store_checkout(uuid, uuid, uuid, text, numeric, date, text) from public, anon;
revoke all on function public.store_return(uuid, numeric) from public, anon;
revoke all on function public.record_invoice_payment(uuid, uuid, numeric, text, text) from public, anon;
revoke all on function public.delete_invoice_payment(uuid) from public, anon;
grant execute on function public.delete_invoice(uuid) to authenticated;
grant execute on function public.delete_order(uuid) to authenticated;
grant execute on function public.deliver_order(uuid) to authenticated;
grant execute on function public.create_export_invoice(jsonb) to authenticated;
grant execute on function public.update_export_invoice(uuid, jsonb) to authenticated;
grant execute on function public.delete_export_invoice(uuid) to authenticated;
grant execute on function public.store_checkout(uuid, uuid, uuid, text, numeric, date, text) to authenticated;
grant execute on function public.store_return(uuid, numeric) to authenticated;
grant execute on function public.record_invoice_payment(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.delete_invoice_payment(uuid) to authenticated;

-- ============================================================ E. per-action RLS write policies
-- SELECT policies are untouched (viewing stays business-scoped; hiding is a UI concern).
-- Each write policy keeps the business check AND adds the matching permission.

-- products (updates also allowed via adjust_stock; deletes have no UI/action — restrict to edit)
drop policy if exists "biz members insert products" on public.products;
drop policy if exists "biz members update products" on public.products;
drop policy if exists "biz members delete products" on public.products;
create policy "rbac insert products" on public.products for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'inventory', 'create'));
create policy "rbac update products" on public.products for update
  using (business_id = public.current_business_id()
         and (public.has_permission(business_id, 'inventory', 'edit') or public.has_permission(business_id, 'inventory', 'adjust_stock')));
create policy "rbac delete products" on public.products for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'inventory', 'edit'));

-- suppliers
drop policy if exists "biz members insert suppliers" on public.suppliers;
drop policy if exists "biz members update suppliers" on public.suppliers;
drop policy if exists "biz members delete suppliers" on public.suppliers;
create policy "rbac insert suppliers" on public.suppliers for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'suppliers', 'create'));
create policy "rbac update suppliers" on public.suppliers for update
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'suppliers', 'edit'));
create policy "rbac delete suppliers" on public.suppliers for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'suppliers', 'delete'));

-- raw materials + purchases
drop policy if exists "biz members insert raw_materials" on public.raw_materials;
drop policy if exists "biz members update raw_materials" on public.raw_materials;
drop policy if exists "biz members delete raw_materials" on public.raw_materials;
create policy "rbac insert raw_materials" on public.raw_materials for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'raw_materials', 'create'));
create policy "rbac update raw_materials" on public.raw_materials for update
  using (business_id = public.current_business_id()
         and (public.has_permission(business_id, 'raw_materials', 'edit')
              or public.has_permission(business_id, 'raw_materials', 'adjust_stock')
              or public.has_permission(business_id, 'raw_materials', 'record_purchase')));
create policy "rbac delete raw_materials" on public.raw_materials for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'raw_materials', 'edit'));
drop policy if exists "biz members insert material_purchases" on public.material_purchases;
create policy "rbac insert material_purchases" on public.material_purchases for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'raw_materials', 'record_purchase'));

-- invoices (direct writes; RPC paths are definer + guarded above)
drop policy if exists "invoices_insert" on public.invoices;
drop policy if exists "invoices_update" on public.invoices;
drop policy if exists "invoices_delete" on public.invoices;
create policy "rbac insert invoices" on public.invoices for insert to authenticated
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'invoices', 'create'));
create policy "rbac update invoices" on public.invoices for update to authenticated
  using (business_id = public.current_business_id()
         and (public.has_permission(business_id, 'invoices', 'edit') or public.has_permission(business_id, 'invoices', 'status_change')));
create policy "rbac delete invoices" on public.invoices for delete to authenticated
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'invoices', 'delete'));

-- orders (+ items follow the parent)
drop policy if exists "biz members insert orders" on public.orders;
drop policy if exists "biz members update orders" on public.orders;
drop policy if exists "biz members delete orders" on public.orders;
create policy "rbac insert orders" on public.orders for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'pos', 'orders_manage'));
create policy "rbac update orders" on public.orders for update
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'pos', 'orders_manage'));
create policy "rbac delete orders" on public.orders for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'pos', 'orders_delete'));
drop policy if exists "biz members insert order_items" on public.order_items;
drop policy if exists "biz members update order_items" on public.order_items;
drop policy if exists "biz members delete order_items" on public.order_items;
create policy "rbac insert order_items" on public.order_items for insert
  with check (exists (select 1 from public.orders o where o.id = order_id and o.business_id = public.current_business_id()
                      and public.has_permission(o.business_id, 'pos', 'orders_manage')));
create policy "rbac update order_items" on public.order_items for update
  using (exists (select 1 from public.orders o where o.id = order_id and o.business_id = public.current_business_id()
                 and public.has_permission(o.business_id, 'pos', 'orders_manage')));
create policy "rbac delete order_items" on public.order_items for delete
  using (exists (select 1 from public.orders o where o.id = order_id and o.business_id = public.current_business_id()
                 and public.has_permission(o.business_id, 'pos', 'orders_manage')));

-- sales / sale_items (POS online checkout inserts directly)
drop policy if exists "biz members insert sales" on public.sales;
create policy "rbac insert sales" on public.sales for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'pos', 'view'));
drop policy if exists "biz members insert sale_items" on public.sale_items;
create policy "rbac insert sale_items" on public.sale_items for insert
  with check (exists (select 1 from public.sales s where s.id = sale_id and s.business_id = public.current_business_id()
                      and public.has_permission(s.business_id, 'pos', 'view')));

-- stock adjustments (target decides which module's adjust_stock applies)
drop policy if exists "stock_adj_insert" on public.stock_adjustments;
create policy "rbac insert stock_adjustments" on public.stock_adjustments for insert to authenticated
  with check (business_id = public.current_business_id()
              and ((product_id is not null and public.has_permission(business_id, 'inventory', 'adjust_stock'))
                   or (raw_material_id is not null and public.has_permission(business_id, 'raw_materials', 'adjust_stock'))));

-- purchase orders
drop policy if exists "po_insert" on public.purchase_orders;
drop policy if exists "po_update" on public.purchase_orders;
drop policy if exists "po_delete" on public.purchase_orders;
create policy "rbac insert purchase_orders" on public.purchase_orders for insert to authenticated
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'purchase_orders', 'create'));
create policy "rbac update purchase_orders" on public.purchase_orders for update to authenticated
  using (business_id = public.current_business_id()
         and (public.has_permission(business_id, 'purchase_orders', 'status_change') or public.has_permission(business_id, 'purchase_orders', 'receive')));
create policy "rbac delete purchase_orders" on public.purchase_orders for delete to authenticated
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'purchase_orders', 'delete'));

-- general store
drop policy if exists "biz members insert store_items" on public.store_items;
drop policy if exists "biz members update store_items" on public.store_items;
drop policy if exists "biz members delete store_items" on public.store_items;
create policy "rbac insert store_items" on public.store_items for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'general_store', 'item_manage'));
create policy "rbac update store_items" on public.store_items for update
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'general_store', 'item_manage'));
create policy "rbac delete store_items" on public.store_items for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'general_store', 'item_delete'));
drop policy if exists "biz members insert store_staff" on public.store_staff;
drop policy if exists "biz members update store_staff" on public.store_staff;
drop policy if exists "biz members delete store_staff" on public.store_staff;
create policy "rbac insert store_staff" on public.store_staff for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'general_store', 'staff_manage'));
create policy "rbac update store_staff" on public.store_staff for update
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'general_store', 'staff_manage'));
create policy "rbac delete store_staff" on public.store_staff for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'general_store', 'staff_delete'));

-- export invoices (direct table writes; the RPCs are the normal path)
drop policy if exists "biz members insert export_invoices" on public.export_invoices;
drop policy if exists "biz members update export_invoices" on public.export_invoices;
drop policy if exists "biz members delete export_invoices" on public.export_invoices;
create policy "rbac insert export_invoices" on public.export_invoices for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'export_invoices', 'create'));
create policy "rbac update export_invoices" on public.export_invoices for update
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'export_invoices', 'edit'));
create policy "rbac delete export_invoices" on public.export_invoices for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'export_invoices', 'delete'));

-- team: invitations + user_roles now follow team.* permissions (owner still passes everything)
drop policy if exists "Owners create invitations for their business" on public.invitations;
drop policy if exists "Owners update invitations for their business" on public.invitations;
drop policy if exists "Owners delete invitations for their business" on public.invitations;
create policy "rbac insert invitations" on public.invitations for insert
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'team', 'invite'));
create policy "rbac update invitations" on public.invitations for update
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'team', 'invite'));
create policy "rbac delete invitations" on public.invitations for delete
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'team', 'invite'));
-- Permissive OR with the existing owner/manager select policy: team.view grants read access too.
create policy "rbac view invitations" on public.invitations for select
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'team', 'view'));
drop policy if exists "Owners manage roles in their business" on public.user_roles;
create policy "rbac manage user_roles" on public.user_roles for all
  using (business_id = public.current_business_id() and public.has_permission(business_id, 'team', 'role_change'))
  with check (business_id = public.current_business_id() and public.has_permission(business_id, 'team', 'role_change'));

-- ============================================================ F. realtime
do $$ begin
  alter publication supabase_realtime add table public.team_roles;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.member_access;
exception when duplicate_object then null; end $$;

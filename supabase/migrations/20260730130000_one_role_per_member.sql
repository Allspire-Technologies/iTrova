-- One role per member + atomic role change.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).

-- Dedupe accumulated roles: keep each member's highest-privilege one (what the app resolved anyway).
delete from public.user_roles ur
using public.user_roles keep
where keep.user_id = ur.user_id
  and keep.business_id = ur.business_id
  and keep.role <> ur.role
  and (case keep.role when 'owner' then 1 when 'manager' then 2 else 3 end)
    < (case ur.role when 'owner' then 1 when 'manager' then 2 else 3 end);

create unique index if not exists user_roles_one_per_member
  on public.user_roles (user_id, business_id);

-- Atomic role change; also sets/clears the custom team role so base role and permission map can't
-- drift. Clearing wipes any per-member override (same convention as Permissions & Access).
create or replace function public.set_member_role(_user_id uuid, _role public.app_role, _team_role_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_biz uuid := public.current_business_id();
  v_base public.app_role := _role;
begin
  if v_biz is null then raise exception 'not signed in to a business'; end if;
  if not public.has_permission(v_biz, 'team', 'role_change') then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if _user_id = auth.uid() then raise exception 'You can''t change your own role'; end if;
  if _role = 'owner' then raise exception 'Ownership can''t be assigned here'; end if;
  if public.has_business_role(v_biz, _user_id, 'owner') then
    raise exception 'The owner''s role can''t be changed';
  end if;
  if not exists (select 1 from public.user_roles where user_id = _user_id and business_id = v_biz) then
    raise exception 'Not a member of this business';
  end if;

  if _team_role_id is not null then
    if not exists (
      select 1 from public.team_roles
      where id = _team_role_id and business_id = v_biz and system_key is null
    ) then
      raise exception 'Unknown role for this business';
    end if;
    v_base := 'cashier';  -- custom roles ride on the least-privilege base role
  end if;

  update public.user_roles set role = v_base
  where user_id = _user_id and business_id = v_biz;

  insert into public.member_access (user_id, business_id, team_role_id, permissions)
  values (_user_id, v_biz, _team_role_id, null)
  on conflict (user_id, business_id)
  do update set team_role_id = excluded.team_role_id, permissions = null, updated_at = now();
end $$;

revoke all on function public.set_member_role(uuid, public.app_role, uuid) from public, anon;
grant execute on function public.set_member_role(uuid, public.app_role, uuid) to authenticated;

notify pgrst, 'reload schema';

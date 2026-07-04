-- Permissions & Access (RBAC v1): custom team roles + per-member module×action permissions.
-- Enforcement is UI-level in v1 (data RLS stays business-scoped); these tables are the source of
-- truth the client resolves against. A business with no rows here behaves exactly as today —
-- Manager/Cashier defaults live in code and only materialize into team_roles when edited.

-- 0. Register the export_invoices module in the catalogue (it was wired in the app but never
--    inserted here). Enabling it per plan stays the manual plans.modules workflow.
insert into public.app_modules (key, label, path, sort_order) values
  ('export_invoices', 'Export invoices', '/export-invoice', 17)
on conflict (key) do nothing;

-- 1. Team roles: custom roles plus lazily-materialized system defaults.
--    system_key = 'manager'|'cashier' when the row is an edited default; null = custom role.
create table if not exists public.team_roles (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null,
  system_key   public.app_role check (system_key is distinct from 'owner'),
  permissions  jsonb not null default '{}'::jsonb,  -- { module: [action, ...] }
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, system_key),
  unique (business_id, name)
);

-- 2. Per-member assignment + optional explicit override.
--    permissions null = inherit the assigned role (or code defaults); non-null = explicit map.
create table if not exists public.member_access (
  user_id      uuid not null,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  team_role_id uuid references public.team_roles(id) on delete set null,
  permissions  jsonb,
  updated_at   timestamptz not null default now(),
  primary key (user_id, business_id)
);

alter table public.team_roles    enable row level security;
alter table public.member_access enable row level security;

-- Every member can read (a cashier must load their own map at login).
create policy "biz members view team_roles"    on public.team_roles    for select using (business_id = public.current_business_id());
create policy "biz members view member_access" on public.member_access for select using (business_id = public.current_business_id());

-- Writes: the owner freely; a manager with anti-escalation guards —
--   * cannot write their OWN member_access row,
--   * cannot write a row targeting the business owner,
--   * cannot modify a team_role assigned to themselves, nor the system role of their own rank.
create policy "admins write member_access" on public.member_access
for all using (
  business_id = public.current_business_id()
  and (
    public.has_business_role(business_id, auth.uid(), 'owner')
    or (
      public.has_business_role(business_id, auth.uid(), 'manager')
      and user_id <> auth.uid()
      and not public.has_business_role(business_id, user_id, 'owner')
    )
  )
) with check (
  business_id = public.current_business_id()
  and (
    public.has_business_role(business_id, auth.uid(), 'owner')
    or (
      public.has_business_role(business_id, auth.uid(), 'manager')
      and user_id <> auth.uid()
      and not public.has_business_role(business_id, user_id, 'owner')
    )
  )
);

create policy "admins write team_roles" on public.team_roles
for all using (
  business_id = public.current_business_id()
  and (
    public.has_business_role(business_id, auth.uid(), 'owner')
    or (
      public.has_business_role(business_id, auth.uid(), 'manager')
      and (system_key is null or not public.has_business_role(business_id, auth.uid(), system_key))
      and not exists (
        select 1 from public.member_access ma
        where ma.business_id = team_roles.business_id
          and ma.user_id = auth.uid()
          and ma.team_role_id = team_roles.id
      )
    )
  )
) with check (
  business_id = public.current_business_id()
  and (
    public.has_business_role(business_id, auth.uid(), 'owner')
    or (
      public.has_business_role(business_id, auth.uid(), 'manager')
      and (system_key is null or not public.has_business_role(business_id, auth.uid(), system_key))
      and not exists (
        select 1 from public.member_access ma
        where ma.business_id = team_roles.business_id
          and ma.user_id = auth.uid()
          and ma.team_role_id = team_roles.id
      )
    )
  )
);

grant select, insert, update, delete on public.team_roles    to authenticated;
grant select, insert, update, delete on public.member_access to authenticated;
grant all on public.team_roles    to service_role;
grant all on public.member_access to service_role;

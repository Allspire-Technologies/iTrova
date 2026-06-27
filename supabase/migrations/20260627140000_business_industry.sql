-- Capture a business's industry/sector.
--
-- Businesses had no industry field, so the Admin OS (CRM) could never show or segment by it.
-- Add a nullable column and persist it from signup metadata (raw_user_meta_data->>'industry').
-- Existing businesses stay null until the owner sets it in Settings.

alter table public.businesses
  add column if not exists industry text;

-- Recreate handle_new_user so a new owner's chosen industry lands on their business. Unchanged
-- otherwise: invited staff (invite_token) still get only a profile and no business.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  new_business_id uuid;
begin
  if new.raw_user_meta_data->>'invite_token' is not null then
    insert into public.profiles (id, owner_name, phone)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', 'Staff'),
      new.raw_user_meta_data->>'phone'
    );
    return new;
  end if;

  insert into public.businesses (name, owner_id, industry)
  values (
    coalesce(new.raw_user_meta_data->>'business_name', 'My Business'),
    new.id,
    nullif(new.raw_user_meta_data->>'industry', '')
  )
  returning id into new_business_id;

  insert into public.profiles (id, owner_name, phone, business_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'owner_name', 'Owner'),
    new.raw_user_meta_data->>'phone',
    new_business_id
  );

  insert into public.user_roles (user_id, business_id, role)
  values (new.id, new_business_id, 'owner')
  on conflict do nothing;

  return new;
end;
$$;

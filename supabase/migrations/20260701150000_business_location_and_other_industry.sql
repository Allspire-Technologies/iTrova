-- Capture a business's location (city + state) and, when its industry is "Other", the free-text
-- industry name — none of which had anywhere to live before.
--
-- industry stays the curated value (so the Admin OS keeps segmenting on it, incl. "Other"); the
-- typed-in name lands in industry_other. Existing businesses stay null until the owner sets them
-- in Settings.

alter table public.businesses
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists industry_other text;

-- Recreate handle_new_user so a new owner's location and "Other" industry name land on their
-- business. Unchanged otherwise: invited staff (invite_token) still get only a profile and no
-- business; empty strings become NULL via nullif().
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

  insert into public.businesses (name, owner_id, industry, industry_other, city, state)
  values (
    coalesce(new.raw_user_meta_data->>'business_name', 'My Business'),
    new.id,
    nullif(new.raw_user_meta_data->>'industry', ''),
    nullif(new.raw_user_meta_data->>'industry_other', ''),
    nullif(new.raw_user_meta_data->>'city', ''),
    nullif(new.raw_user_meta_data->>'state', '')
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

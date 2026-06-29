-- Precise invite status for the accept/auth pages. get_invite_preview returns an empty row for
-- used / expired / not-found alike, so the UI can't tell "already used" from "invalid". This RPC
-- always returns exactly one row with a status, and exposes the business/email/role only for a
-- still-valid invite (so a leaked, already-used token doesn't disclose who it was for).

create or replace function public.get_invite_state(_token text)
returns table(status text, business_name text, email text, role public.app_role)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    s.status,
    case when s.status = 'valid' then b.name end,
    case when s.status = 'valid' then i.email end,
    case when s.status = 'valid' then i.role end
  from (select _token as t) q
  left join public.invitations i on i.token = q.t
  left join public.businesses b on b.id = i.business_id
  cross join lateral (
    select case
      when i.id is null              then 'not_found'
      when i.accepted_at is not null then 'used'
      when i.expires_at < now()      then 'expired'
      else 'valid'
    end as status
  ) s;
end;
$$;

revoke all on function public.get_invite_state(text) from public;
grant execute on function public.get_invite_state(text) to anon, authenticated;

-- Harden accept_invitation: UPSERT the profile instead of UPDATE. If the teammate's profile row
-- is missing when they accept (e.g. a trigger race on signup), the old UPDATE hit 0 rows — leaving
-- them with a user_roles row but no profiles.business_id. The result: they showed as "Unnamed" in
-- the owner's Team and couldn't see the business, despite having a role. The upsert guarantees the
-- profile exists and points at the business (and backfills a name from the email if none).
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

  update public.invitations
  set accepted_at = now(), accepted_by = uid
  where id = inv.id;

  return inv.business_id;
end;
$$;

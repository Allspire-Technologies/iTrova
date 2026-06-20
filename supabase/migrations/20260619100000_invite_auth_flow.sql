-- 1. Public RPC: preview an invitation without authentication
--    Returns business name, role, and email for a valid, unaccepted, unexpired token.
--    Safe to expose to anon because it only reveals info the token holder already has.
CREATE OR REPLACE FUNCTION public.get_invite_preview(_token TEXT)
RETURNS TABLE(business_name TEXT, role public.app_role, email TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT b.name, i.role, i.email
  FROM public.invitations i
  JOIN public.businesses b ON b.id = i.business_id
  WHERE i.token = _token
    AND i.accepted_at IS NULL
    AND i.expires_at > now();
END;
$$;

REVOKE ALL ON FUNCTION public.get_invite_preview(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invite_preview(TEXT) TO anon, authenticated;

-- 2. Fix handle_new_user: skip business creation for invite-signup accounts.
--    When raw_user_meta_data contains 'invite_token', the user is joining an existing
--    business — accept_invitation will attach them. Creating a phantom business here
--    would leave them pointing at the wrong business_id.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_business_id UUID;
BEGIN
  IF NEW.raw_user_meta_data->>'invite_token' IS NOT NULL THEN
    INSERT INTO public.profiles (id, owner_name, phone)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', 'Staff'),
      NEW.raw_user_meta_data->>'phone'
    );
    RETURN NEW;
  END IF;

  INSERT INTO public.businesses (name, owner_id)
  VALUES (COALESCE(NEW.raw_user_meta_data->>'business_name', 'My Business'), NEW.id)
  RETURNING id INTO new_business_id;

  INSERT INTO public.profiles (id, owner_name, phone, business_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'owner_name', 'Owner'),
    NEW.raw_user_meta_data->>'phone',
    new_business_id
  );

  INSERT INTO public.user_roles (user_id, business_id, role)
  VALUES (NEW.id, new_business_id, 'owner')
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

-- 3. Fix accept_invitation: always update profiles.business_id (remove IS NULL guard).
--    Invite-signup accounts have no business_id yet; existing users accepting a second
--    business invite should be redirected to the new business. Both cases need a forced update.
CREATE OR REPLACE FUNCTION public.accept_invitation(_token TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv public.invitations%ROWTYPE;
  uid UUID := auth.uid();
  user_email TEXT;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT email INTO user_email FROM auth.users WHERE id = uid;

  SELECT * INTO inv FROM public.invitations WHERE token = _token;
  IF inv.id IS NULL THEN RAISE EXCEPTION 'Invitation not found'; END IF;
  IF inv.accepted_at IS NOT NULL THEN RAISE EXCEPTION 'Invitation already used'; END IF;
  IF inv.expires_at < now() THEN RAISE EXCEPTION 'Invitation expired'; END IF;
  IF lower(inv.email) <> lower(COALESCE(user_email, '')) THEN
    RAISE EXCEPTION 'Invitation email does not match your account';
  END IF;

  INSERT INTO public.user_roles (user_id, business_id, role)
  VALUES (uid, inv.business_id, inv.role)
  ON CONFLICT DO NOTHING;

  UPDATE public.profiles SET business_id = inv.business_id WHERE id = uid;

  UPDATE public.invitations
  SET accepted_at = now(), accepted_by = uid
  WHERE id = inv.id;

  RETURN inv.business_id;
END;
$$;

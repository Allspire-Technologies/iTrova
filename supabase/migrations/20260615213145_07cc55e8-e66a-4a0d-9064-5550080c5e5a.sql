
-- 1. Role enum
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('owner', 'manager', 'cashier');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, business_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Security-definer role checks (avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_business_role(_business_id UUID, _user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE business_id = _business_id AND user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.user_business_role(_user_id UUID, _business_id UUID)
RETURNS public.app_role
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id AND business_id = _business_id
  ORDER BY CASE role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END
  LIMIT 1
$$;

-- 4. user_roles policies
CREATE POLICY "Members can view roles in their business"
ON public.user_roles FOR SELECT TO authenticated
USING (business_id = public.current_business_id());

CREATE POLICY "Owners manage roles in their business"
ON public.user_roles FOR ALL TO authenticated
USING (public.has_business_role(business_id, auth.uid(), 'owner'))
WITH CHECK (public.has_business_role(business_id, auth.uid(), 'owner'));

-- 5. Invitations table
CREATE TABLE IF NOT EXISTS public.invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.app_role NOT NULL DEFAULT 'cashier',
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '14 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitations_business_idx ON public.invitations(business_id);
CREATE INDEX IF NOT EXISTS invitations_email_idx ON public.invitations(lower(email));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO service_role;

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view invitations for their business"
ON public.invitations FOR SELECT TO authenticated
USING (public.has_business_role(business_id, auth.uid(), 'owner')
    OR public.has_business_role(business_id, auth.uid(), 'manager'));

CREATE POLICY "Owners create invitations for their business"
ON public.invitations FOR INSERT TO authenticated
WITH CHECK (public.has_business_role(business_id, auth.uid(), 'owner'));

CREATE POLICY "Owners update invitations for their business"
ON public.invitations FOR UPDATE TO authenticated
USING (public.has_business_role(business_id, auth.uid(), 'owner'))
WITH CHECK (public.has_business_role(business_id, auth.uid(), 'owner'));

CREATE POLICY "Owners delete invitations for their business"
ON public.invitations FOR DELETE TO authenticated
USING (public.has_business_role(business_id, auth.uid(), 'owner'));

CREATE TRIGGER invitations_set_updated_at
BEFORE UPDATE ON public.invitations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. RPC to accept an invitation (security definer so the invitee can join even before RLS sees them as a member)
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

  -- Attach profile to the invited business if profile has no business yet
  UPDATE public.profiles SET business_id = inv.business_id
  WHERE id = uid AND business_id IS NULL;

  UPDATE public.invitations
  SET accepted_at = now(), accepted_by = uid
  WHERE id = inv.id;

  RETURN inv.business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_invitation(TEXT) TO authenticated;

-- 7. Update handle_new_user so first-time signups also seed an owner role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_business_id UUID;
BEGIN
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

-- 8. Backfill: every existing business owner becomes an owner in user_roles
INSERT INTO public.user_roles (user_id, business_id, role)
SELECT b.owner_id, b.id, 'owner'::public.app_role
FROM public.businesses b
WHERE b.owner_id IS NOT NULL
ON CONFLICT DO NOTHING;

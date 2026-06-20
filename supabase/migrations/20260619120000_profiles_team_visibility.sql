-- Allow members of the same business to read each other's profiles.
-- The existing "users view own profile" policy only allows seeing your own row,
-- which breaks the Team module (owner cannot read teammates' last_seen / owner_name).
DROP POLICY IF EXISTS "users view own profile" ON public.profiles;

CREATE POLICY "users view own profile" ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR (business_id IS NOT NULL AND business_id = public.current_business_id())
  );

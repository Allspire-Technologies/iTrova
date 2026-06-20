DROP POLICY IF EXISTS "users view own profile" ON public.profiles;

CREATE POLICY "users view own profile" ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR (business_id IS NOT NULL AND business_id = public.current_business_id())
  );
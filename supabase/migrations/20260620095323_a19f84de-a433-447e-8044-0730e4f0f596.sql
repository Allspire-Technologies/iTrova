DROP POLICY IF EXISTS "owners view own business" ON public.businesses;

CREATE POLICY "members view own business" ON public.businesses
  FOR SELECT
  USING (
    auth.uid() = owner_id OR
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND business_id = businesses.id
    )
  );
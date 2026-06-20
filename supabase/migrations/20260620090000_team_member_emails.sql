-- Returns emails for all members of a given business.
-- Caller must themselves be a member of that business.
CREATE OR REPLACE FUNCTION get_member_emails(p_business_id UUID)
RETURNS TABLE(user_id UUID, email TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT ur.user_id, au.email
  FROM public.user_roles ur
  JOIN auth.users au ON au.id = ur.user_id
  WHERE ur.business_id = p_business_id
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND business_id = p_business_id
    );
$$;

-- The daily email-alerts GitHub Action runs as service_role and reads public.plans directly
-- to resolve each plan's limits. service_role had no SELECT grant on plans, so the run failed
-- with "permission denied for table plans" (42501). Grant it (plans is a public catalogue,
-- already readable by every authenticated user via RLS).
grant select on public.plans to service_role;

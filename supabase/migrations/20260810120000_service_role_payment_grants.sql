-- The payment path's service_role grants, written down.
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu).
--
-- Symptom on production go-live: "permission denied for function quote_subscription_price", then
-- "permission denied for table billing_payment" — from create-payment, which runs as service_role.
-- Staging was fine, so nothing in CI or the staging test could catch it.
--
-- Mechanism: our migrations end each object with `revoke all ... from public` to keep anon out.
-- That also removes the PUBLIC grant service_role was silently relying on. Newer Supabase projects
-- (staging) carry ALTER DEFAULT PRIVILEGES granting service_role on new objects, so the revoke did
-- no harm there; the older production project has no such default, so the same migration produced
-- different ACLs on the two databases.
--
-- Fix, in two layers: name every object the Edge Functions touch (idempotent, re-runnable), and
-- restore the platform's default privileges so the next migration can't reintroduce the gap.
-- activate_subscription_from_payment already grants service_role explicitly — that one was right.

grant execute on function public.quote_subscription_price(uuid, text, text)            to service_role;
grant execute on function public.has_business_role(uuid, uuid, public.app_role)        to service_role;
grant select, insert, update on public.billing_payment                                 to service_role;
grant select                 on public.billing_config                                  to service_role;
grant select                 on public.businesses                                      to service_role;

-- Objects created from here on inherit these, matching what Supabase sets up on a new project.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on functions to service_role;
alter default privileges in schema public grant all on sequences to service_role;

notify pgrst, 'reload schema';

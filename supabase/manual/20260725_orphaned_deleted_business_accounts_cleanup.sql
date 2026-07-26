-- One-time cleanup: auth accounts orphaned by businesses deleted BEFORE the
-- 20260725120000_admin_delete_business_purge_users fix (CRM PR #69 / iTrova #153).
--
-- APPLIES TO THE SHARED iTrova SUPABASE PROJECT (wnuyzsjhijhnhkpcnnqu). Run in the SQL editor
-- (as postgres, so the auth.users delete in STEP 2 is permitted).
--
-- Background: the old admin_delete_business hard-deleted the business but LEFT the owner's and staff's
-- auth.users accounts, only nulling profiles.business_id. Those users can still log in (into an empty
-- shell) and their email stays registered (can't re-sign-up). The new delete purges accounts going
-- forward; this script cleans up the ones left behind.
--
-- SAFETY:
--   • This is IRREVERSIBLE — deleting auth.users cascades their profiles, sessions, identities.
--   • RUN STEP 1 FIRST and eyeball the emails. Only run STEP 2 once you recognise them as users of
--     deleted businesses. If STEP 1 returns 0 rows, there are no orphans — stop, nothing to do.
--   • The shared project ALSO hosts iTrova-CRM internal staff (platform_admins / cs_staff_role), and
--     some of them DO have a public.profiles row (so the profiles join alone does NOT exclude them).
--     They are excluded EXPLICITLY by the two staff checks in the query below — never remove those.
--   • Legitimately pending invited staff (signed up, not yet accepted) also have a null business_id;
--     they are excluded via the "no unaccepted invitation" check so they are NOT deleted.

-- The candidate set (reused verbatim by both steps): an iTrova user (has a profile) with no business,
-- no role, no pending invitation, and who is NOT internal CRM staff.
--   • has a profiles row                     → an iTrova user
--   • profiles.business_id is null           → not attached to any business
--   • owns no business                       → not a live owner
--   • has no user_roles                      → not a member of any business
--   • has no unaccepted invitation           → not a pending invitee (matched case-insensitively)
--   • not in platform_admins / cs_staff_role → not iTrova-CRM internal staff (they share this project)

-- ============================================================================ STEP 1 — REVIEW (read-only)
select u.id, u.email, u.created_at, p.owner_name, p.phone
from auth.users u
join public.profiles p on p.id = u.id
where p.business_id is null
  and not exists (select 1 from public.businesses b where b.owner_id = u.id)
  and not exists (select 1 from public.user_roles r where r.user_id = u.id)
  and not exists (
    select 1 from public.invitations i
    where lower(i.email) = lower(u.email) and i.accepted_at is null
  )
  -- Exclude iTrova-CRM internal staff — they live on this same shared project.
  and not exists (select 1 from public.platform_admins pa where pa.user_id = u.id)
  and not exists (select 1 from public.cs_staff_role sr where sr.user_id = u.id)
order by u.created_at;

-- ============================================================================ STEP 2 — DELETE (run only
-- after reviewing STEP 1). Uncomment the block and run. profiles/sessions/identities cascade off
-- auth.users; those users' logins stop working and their emails are freed to register a new business.
--
-- begin;
--   with orphans as (
--     select u.id
--     from auth.users u
--     join public.profiles p on p.id = u.id
--     where p.business_id is null
--       and not exists (select 1 from public.businesses b where b.owner_id = u.id)
--       and not exists (select 1 from public.user_roles r where r.user_id = u.id)
--       and not exists (
--         select 1 from public.invitations i
--         where lower(i.email) = lower(u.email) and i.accepted_at is null
--       )
--       and not exists (select 1 from public.platform_admins pa where pa.user_id = u.id)
--       and not exists (select 1 from public.cs_staff_role sr where sr.user_id = u.id)
--   )
--   delete from auth.users where id in (select id from orphans);
-- commit;
--
-- Tip: run the DELETE inside the transaction above and check the reported row count matches STEP 1
-- before COMMIT; if it doesn't look right, ROLLBACK instead.

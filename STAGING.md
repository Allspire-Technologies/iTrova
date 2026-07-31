# Staging environment

A full copy of iTrova that nobody's real business depends on.

| | Production | Staging |
|---|---|---|
| Branch | `main` | `staging` |
| Cloudflare worker | `itrova` | `itrova-staging` |
| Supabase project | the live one | a separate project |
| Deploys when | you merge to `main` | you merge to `staging` |

Both branches run the same CI (lint, types, unit, e2e); only the deploy target and database differ.
The workflow refuses to publish if the built bundle doesn't match the branch, and refuses to build
staging against the production Supabase URL — see `.github/workflows/ci.yml`.

---

## One-time setup

Steps 1, 2, 3 and 5 need dashboard access, so they're yours to run. Step 4 is already committed.

### 1. Create the staging Supabase project

In the Supabase dashboard: **New project** (same region as production is easiest).
From **Project Settings → API**, copy the **Project URL** and the **anon/publishable key**.

### 2. Copy the schema across

Production holds *both* the iTrova and CRM schemas in one project, so a single dump covers both.
Grab the connection strings from **Project Settings → Database → Connection string (URI)** on each
project, then:

```bash
PROD='postgresql://postgres.<prod-ref>:<password>@<host>:5432/postgres'
STAGING='postgresql://postgres.<staging-ref>:<password>@<host>:5432/postgres'

# Schema only — no rows, so no real customer data is ever copied.
pg_dump "$PROD" --schema=public --schema-only --no-owner --no-privileges -f schema.sql
psql "$STAGING" -f schema.sql
```

Then run this in the staging **SQL editor**. It is *not* in the dump — the trigger lives on
`auth.users`, which sits outside the `public` schema — and **without it signup silently creates an
account with no business, and the app signs the user straight back out**:

```sql
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
```

If `psql` reports a missing extension, enable it under **Database → Extensions** on staging and
re-run. Spot-check afterwards that `businesses`, `products`, `cs_referrer` and `referral_config`
all exist, then sign up a test business to confirm the trigger fired.

### 3. Add the GitHub secrets

**Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Value |
|---|---|
| `STAGING_VITE_SUPABASE_URL` | staging Project URL |
| `STAGING_VITE_SUPABASE_PUBLISHABLE_KEY` | staging anon key |

The existing `VITE_SUPABASE_*` and `CLOUDFLARE_*` secrets stay as they are — production keeps using
them, and both branches share the same Cloudflare credentials.

### 4. Create the branch

```bash
git checkout main && git pull origin main
git checkout -b staging
git push -u origin staging
```

The first push deploys `itrova-staging`, and Cloudflare prints its `*.workers.dev` URL in the job log.

### 5. Protect it

**Settings → Branches → Add rule** for `staging`: require a pull request and require the
**Lint, types & unit tests** and **Playwright e2e** checks to pass. That keeps staging in a state
your team can actually test against.

---

## Day-to-day

```
feature branch ──PR──▶ staging ──▶ deploys itrova-staging ──▶ verify
                          │
                          └──PR──▶ main ──▶ deploys production
```

1. Branch off `staging`, open a PR into `staging`.
2. Merge — CI deploys to `itrova-staging`. Test it there against staging data.
3. Open a PR from `staging` into `main` to promote. Merging deploys production.

**Migrations follow the same path.** Apply a new migration to the *staging* project first and
confirm it behaves, then apply it to production when you promote the branch. That's the main thing
staging buys you: a migration rehearsal that can't hurt anyone.

## Worth knowing

- **Staging data is disposable.** It starts empty — sign up a test business and create your own
  products/invoices. Never copy real customer rows into it.
- **Staging and production can drift.** If you ever apply a migration only to production, staging
  will be behind. Re-run step 2 to reset it.
- **The CRM is a separate repo** (`iTrova-crm`) with its own deploy. Its staging deploy isn't wired
  up yet; the CRM tables exist in the staging database, but the CRM app still points at production.
- **Emails and WhatsApp links are real.** Edge Functions on staging use whatever tokens you give
  them, so use your own address when testing anything that sends.

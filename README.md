# iTrova New App

## Email alerts (renewal reminders + limit warnings)

A scheduled GitHub Action (`.github/workflows/email-alerts.yml`) runs daily and emails the
business **owner**:

- **Renewal reminder** ~3 days before `subscription_renews_at` (paid plans only).
- **Limit warnings** at **80%** of a cap and again **at the cap**, for every limited resource
  (products, suppliers, raw materials, purchase orders, invoices, team members).

Each alert is idempotent (recorded in `email_alerts_sent`), so it never repeats. The
selection/threshold logic lives in `src/lib/emailAlerts.ts` (unit-tested) and is reused by
`scripts/email-alerts.ts`, which sends via **sender.net SMTP** with `nodemailer`.

### Setup

1. **Apply the migration** `supabase/migrations/20260626140000_app_email_alerts.sql` to the
   live Supabase project (`wnuyzsjhijhnhkpcnnqu`) — adds `email_alerts_sent` and the
   `businesses_alert_snapshot()` RPC.

2. **Add the GitHub Actions secrets** (repo → Settings → Secrets and variables → Actions →
   *Secrets*):

   | Secret | Value |
   |---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role / secret** key (never the anon/publishable key) |
   | `SMTP_HOST` | sender.net SMTP host (e.g. `smtp.sender.net`) |
   | `SMTP_PORT` | `587` (STARTTLS) or `465` (SSL) |
   | `SMTP_USER` | sender.net SMTP username |
   | `SMTP_PASS` | sender.net SMTP password / token |
   | `EMAIL_FROM` | `iTrova <noreply@itrova.allspire.tech>` (a verified sender in sender.net) |

   The Supabase URL is **not** a secret — the workflow reuses the existing repo **Variable**
   `VITE_SUPABASE_URL` (Settings → Secrets and variables → Actions → *Variables*).

3. **Test it:** Actions → **Email alerts** → **Run workflow**. The run logs print
   `N email(s) to send` and a `sent …` line per email. To force one, set a paid business's
   `subscription_renews_at` ~3 days out, or a free business to ≥80% of a cap, then run again.

The daily schedule runs at 07:00 UTC (08:00 Africa/Lagos) once the workflow is on `main`.

### Local run

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… SMTP_HOST=… SMTP_PORT=… SMTP_USER=… \
SMTP_PASS=… EMAIL_FROM=… npm run email-alerts
```

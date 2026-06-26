// Daily email alerts: renewal reminders (3 days out) + limit warnings (80% and at the cap).
// Runs in GitHub Actions as service_role, sends via sender.net SMTP. The selection/threshold
// logic is the unit-tested src/lib helpers so behaviour matches the app.
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";
import { getLimit, registerPlanLimits, type PlanLimits } from "../src/lib/planLimits";
import { effectiveTier } from "../src/lib/subscription";
import {
  isRenewalDueSoon, renewalAlertKey, daysUntil,
  limitWarningLevel, limitAlertKey, RESOURCE_SPECS,
  renewalEmail, limitEmail,
} from "../src/lib/emailAlerts";

type Snapshot = {
  business_id: string;
  business_name: string;
  owner_email: string | null;
  subscription_tier: string | null;
  subscription_renews_at: string | null;
  products: number; suppliers: number; raw_materials: number;
  purchase_orders: number; invoices: number; staff: number;
};

function env(key: string): string {
  const v = process.env[key];
  if (!v) { console.error(`Missing required env: ${key}`); process.exit(1); }
  return v;
}

async function main() {
  const supabase = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const transporter = nodemailer.createTransport({
    host: env("SMTP_HOST"),
    port: Number(env("SMTP_PORT")),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
  });
  const from = env("EMAIL_FROM");
  const now = Date.now();

  const { data: plans, error: planErr } = await supabase.from("plans").select("key, limits");
  if (planErr) throw planErr;
  registerPlanLimits((plans ?? []).map((p: { key: string; limits: PlanLimits | null }) => ({ key: p.key, limits: p.limits })));

  const { data: snap, error: snapErr } = await supabase.rpc("businesses_alert_snapshot");
  if (snapErr) throw snapErr;

  const { data: sentRows, error: sentErr } = await supabase.from("email_alerts_sent").select("business_id, alert_key");
  if (sentErr) throw sentErr;
  const sent = new Set((sentRows ?? []).map((r: { business_id: string; alert_key: string }) => `${r.business_id}|${r.alert_key}`));

  type Job = { business_id: string; alert_key: string; email: string; subject: string; html: string };
  const jobs: Job[] = [];
  const queue = (business_id: string, alert_key: string, email: string | null, subject: string, html: string) => {
    if (!email || sent.has(`${business_id}|${alert_key}`)) return;
    jobs.push({ business_id, alert_key, email, subject, html });
  };

  for (const b of (snap ?? []) as Snapshot[]) {
    const tier = effectiveTier(b.subscription_tier, b.subscription_renews_at, now);

    if (tier !== "free" && b.subscription_renews_at && isRenewalDueSoon(b.subscription_renews_at, now)) {
      const { subject, html } = renewalEmail({
        businessName: b.business_name,
        planName: tier,
        renewsOn: b.subscription_renews_at.slice(0, 10),
        daysLeft: daysUntil(b.subscription_renews_at, now),
      });
      queue(b.business_id, renewalAlertKey(b.subscription_renews_at), b.owner_email, subject, html);
    }

    for (const spec of RESOURCE_SPECS) {
      const limit = getLimit(tier, spec.resource);
      if (limit == null) continue;
      const count = Number((b as unknown as Record<string, number>)[spec.column]);
      const level = limitWarningLevel(count, limit);
      if (!level) continue;
      const { subject, html } = limitEmail({ businessName: b.business_name, label: spec.label, count, limit, level });
      queue(b.business_id, limitAlertKey(spec.resource, level), b.owner_email, subject, html);
    }
  }

  console.log(`${jobs.length} email(s) to send`);
  for (const j of jobs) {
    await transporter.sendMail({ from, to: j.email, subject: j.subject, html: j.html });
    const { error } = await supabase.from("email_alerts_sent").insert({ business_id: j.business_id, alert_key: j.alert_key });
    if (error) console.error(`recording ${j.alert_key} failed: ${error.message}`);
    else console.log(`sent ${j.alert_key} -> ${j.email}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

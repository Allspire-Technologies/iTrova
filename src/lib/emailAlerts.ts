import { type PlanResource } from "./planLimits";

export const DAY_MS = 86_400_000;
const APP_URL = "https://itrova.allspire.tech";

/** True when a paid plan renews within `withinDays` (and hasn't already lapsed). */
export function isRenewalDueSoon(renewsAt: string | null | undefined, now: number, withinDays = 3): boolean {
  if (!renewsAt) return false;
  const t = Date.parse(renewsAt);
  return !Number.isNaN(t) && t > now && t <= now + withinDays * DAY_MS;
}

export function daysUntil(renewsAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(renewsAt) - now) / DAY_MS));
}

/** Keyed by the renewal date so a new billing cycle reminds again, but the same one doesn't. */
export function renewalAlertKey(renewsAt: string): string {
  return `renewal:${renewsAt.slice(0, 10)}`;
}

export type LimitLevel = "approaching" | "reached";

/** "reached" at/over the cap, "approaching" from 80%, else null (incl. unlimited plans). */
export function limitWarningLevel(count: number, limit: number | null | undefined): LimitLevel | null {
  if (limit == null || limit <= 0) return null;
  if (count >= limit) return "reached";
  if (count >= limit * 0.8) return "approaching";
  return null;
}

export function limitAlertKey(resource: PlanResource, level: LimitLevel): string {
  return `limit:${resource}:${level}`;
}

/** Capped resources, mapping the snapshot's count column and a human label to a PlanResource. */
export const RESOURCE_SPECS: { resource: PlanResource; column: string; label: string }[] = [
  { resource: "products",       column: "products",        label: "products" },
  { resource: "suppliers",      column: "suppliers",       label: "suppliers" },
  { resource: "rawMaterials",   column: "raw_materials",   label: "raw materials" },
  { resource: "purchaseOrders", column: "purchase_orders", label: "purchase orders" },
  { resource: "invoices",       column: "invoices",        label: "invoices" },
  { resource: "staff",          column: "staff",           label: "team members" },
];

/** Formats an ISO date as "25 Jul 2026" (UTC, to match the renewal date as stored). */
export function formatAlertDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function shell(title: string, body: string, ctaLabel: string): string {
  return `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
  <h2 style="color:#0f766e;margin:0 0 12px">${title}</h2>
  ${body}
  <p style="margin:24px 0 8px"><a href="${APP_URL}/settings" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">${ctaLabel}</a></p>
  <p style="color:#999;font-size:12px;margin-top:16px">iTrova · ${APP_URL}</p>
</div>`;
}

export function renewalEmail(p: { businessName: string; planName: string; renewsOn: string; daysLeft: number }): { subject: string; html: string } {
  const plural = p.daysLeft === 1 ? "" : "s";
  return {
    subject: `Your iTrova ${p.planName} plan renews in ${p.daysLeft} day${plural}`,
    html: shell("Subscription renewal coming up", `
    <p>Hi ${p.businessName},</p>
    <p>A quick heads-up — your <strong>${p.planName}</strong> subscription renews on <strong>${p.renewsOn}</strong>, ${p.daysLeft} day${plural} from now.</p>
    <p>To keep uninterrupted access to your features, renew from <strong>Settings &rarr; Subscription</strong> — just tap the button below.</p>`, "Renew now"),
  };
}

export function limitEmail(p: { businessName: string; label: string; count: number; limit: number; level: LimitLevel }): { subject: string; html: string } {
  const reached = p.level === "reached";
  const subject = reached ? `You've hit your ${p.label} limit` : `Heads-up: you're close to your ${p.label} limit`;
  const body = reached
    ? `<p>Hi ${p.businessName},</p>
    <p>You've reached your plan's limit of <strong>${p.limit}</strong> ${p.label}, so you can't add more for now.</p>
    <p>Upgrade to <strong>Pro</strong> to lift the cap and keep growing.</p>`
    : `<p>Hi ${p.businessName},</p>
    <p>You've used <strong>${p.count} of ${p.limit}</strong> ${p.label} on your current plan.</p>
    <p>Upgrade to <strong>Pro</strong> for unlimited ${p.label} (and no caps across iTrova).</p>`;
  return { subject, html: shell(subject, body, "Upgrade") };
}

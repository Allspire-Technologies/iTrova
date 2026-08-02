// Monnify API client. Credentials come from Edge Function secrets and never leave the server —
// they must NOT be VITE_ variables, which are compiled into the browser bundle.
//
// Secrets: MONNIFY_API_KEY, MONNIFY_SECRET_KEY, MONNIFY_CONTRACT_CODE, MONNIFY_BASE_URL
// (sandbox: https://sandbox.monnify.com — swap for the live host at go-live).

const BASE = () => Deno.env.get("MONNIFY_BASE_URL") ?? "https://sandbox.monnify.com";
const API_KEY = () => Deno.env.get("MONNIFY_API_KEY") ?? "";
const SECRET = () => Deno.env.get("MONNIFY_SECRET_KEY") ?? "";
export const CONTRACT_CODE = () => Deno.env.get("MONNIFY_CONTRACT_CODE") ?? "";

export function assertConfigured(): string | null {
  if (!API_KEY() || !SECRET() || !CONTRACT_CODE()) {
    return "Monnify isn't configured — set MONNIFY_API_KEY, MONNIFY_SECRET_KEY and MONNIFY_CONTRACT_CODE.";
  }
  return null;
}

/** Bearer token for the REST API. Short-lived, so we fetch per invocation rather than cache. */
async function token(): Promise<string> {
  const basic = btoa(`${API_KEY()}:${SECRET()}`);
  const res = await fetch(`${BASE()}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  const t = body?.responseBody?.accessToken;
  if (!res.ok || !t) throw new Error(`Monnify auth failed (${res.status}): ${body?.responseMessage ?? "no token"}`);
  return t;
}

async function call(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const t = await token();
  const res = await fetch(`${BASE()}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.requestSuccessful === false) {
    throw new Error(`Monnify ${path} failed (${res.status}): ${body?.responseMessage ?? "unknown error"}`);
  }
  return body?.responseBody ?? {};
}

/** A permanent virtual account for a business. Customers transfer here from any bank app. */
export async function createReservedAccount(input: {
  accountReference: string; accountName: string; customerEmail: string; customerName: string;
}) {
  return await call("/api/v2/bank-transfer/reserved-accounts", {
    method: "POST",
    body: JSON.stringify({
      accountReference: input.accountReference,
      accountName: input.accountName.slice(0, 100),
      currencyCode: "NGN",
      contractCode: CONTRACT_CODE(),
      customerEmail: input.customerEmail,
      customerName: input.customerName.slice(0, 100),
      getAllAvailableBanks: true,
    }),
  });
}

/** Hosted checkout for card payment (Phase 2 uses the token this returns for auto-renewal). */
export async function initTransaction(input: {
  amount: number; customerName: string; customerEmail: string;
  paymentReference: string; paymentDescription: string; redirectUrl: string;
}) {
  return await call("/api/v1/merchant/transactions/init-transaction", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amount,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      paymentReference: input.paymentReference,
      paymentDescription: input.paymentDescription.slice(0, 100),
      currencyCode: "NGN",
      contractCode: CONTRACT_CODE(),
      redirectUrl: input.redirectUrl,
      paymentMethods: ["CARD", "ACCOUNT_TRANSFER"],
    }),
  });
}

/** Re-read a transaction from Monnify. The webhook payload alone is never trusted to grant a plan. */
export async function getTransaction(transactionReference: string) {
  const q = encodeURIComponent(transactionReference);
  return await call(`/api/v2/transactions/${q}`, { method: "GET" });
}

/** Monnify signs webhooks with HMAC SHA-512 of the RAW body, keyed by the client secret. */
export async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET()),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, "0")).join("");
  // Constant-time compare — a length-varying or early-exit check leaks the signature byte by byte.
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(signature.trim().toLowerCase());
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

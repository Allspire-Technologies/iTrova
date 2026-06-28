// Active reachability probe. "Offline" means no real internet, not just navigator.onLine — so we
// confirm by hitting Supabase (cross-origin, never cached by the service worker). Any HTTP response
// (even 4xx/5xx) means the internet is up; only a network error / timeout / abort means offline.
//
// HEAD /auth/v1/health is a CORS-simple request (no custom headers → no preflight) and is cheap.

export async function probeSupabase(timeoutMs = 4000): Promise<boolean> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return typeof navigator === "undefined" ? true : navigator.onLine; // can't probe — trust the flag
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${url}/auth/v1/health`, { method: "HEAD", cache: "no-store", mode: "cors", signal: controller.signal });
    return true; // reachable
  } catch {
    return false; // network error / timeout / abort
  } finally {
    clearTimeout(timer);
  }
}

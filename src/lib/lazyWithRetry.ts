import { lazy, type ComponentType } from "react";

// True for the errors a failed dynamic import() throws (browser wording varies).
export function isChunkLoadError(err: unknown): boolean {
  const s = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /ChunkLoadError|dynamically imported module|Loading chunk|Importing a module script failed|error loading dynamically imported module/i.test(s);
}

// Retry a promise-returning factory a few times with a small backoff. Clears a *transient* dynamic
// import() failure (a flaky-connection blip where the same chunk URL would succeed on a retry).
export async function retryImport<T>(factory: () => Promise<T>, retries = 2, delayMs = 350): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await factory();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
    }
  }
  throw lastErr;
}

// After a deploy, the running page can reference chunk hashes that no longer exist (the server
// serves the new build's hashes and the old ones are gone; the SW cache may have rotated too).
// Retrying the *same* URL can't fix that — but a full reload pulls a fresh index.html with the
// current hashes. Do it at most once per short window, keyed in sessionStorage, so a page that's
// genuinely broken/offline can't reload-loop; the second failure falls through to the ErrorBoundary.
const RELOAD_KEY = "itrova:chunk-reload-at";
function recoverFromChunkError(err: unknown): Promise<never> {
  const canReload = typeof window !== "undefined" && typeof sessionStorage !== "undefined";
  if (isChunkLoadError(err) && canReload) {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (!Number.isFinite(last) || Date.now() - last > 15000) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      window.location.reload();
      return new Promise<never>(() => {}); // never resolves — render nothing until the reload lands
    }
  }
  return Promise.reject(err);
}

// Drop-in for React.lazy: retry transient failures, then reload-once to escape a post-deploy stale
// chunk, and only surface to the ErrorBoundary if both fail.
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() => retryImport(factory).catch(recoverFromChunkError));
}

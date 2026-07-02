import { lazy, type ComponentType } from "react";

// Retry a promise-returning factory a few times with a small backoff. Used for code-split route
// imports: a dynamic import() can fail transiently on a flaky connection, or right after a deploy
// when a cached HTML references a hashed chunk that 404s until the new service-worker cache takes
// over. Retrying clears those without bothering the user; only a persistent failure (truly
// offline / chunk really gone) propagates to the ErrorBoundary.
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

// Drop-in for React.lazy that retries the import before giving up.
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(() => retryImport(factory));
}

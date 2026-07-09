// Shared fetch wrapper for the geophysical feeds (USGS / EONET / EMSC / GDACS).
//
// Why this exists: measured from this network, roughly one TCP connect in three
// to earthquake.usgs.gov's CloudFront edge hangs outright (connect never
// completes, ~84s before the socket gives up), while the other two complete in
// under 300ms. DNS is fine; there is no proxy. The same anycast flakiness shows
// up on the other geophysical hosts.
//
// The previous 8s AbortSignal meant that whenever a hung edge was selected, the
// fetch aborted and the caller's `catch { return [] }` silently dropped the
// ENTIRE source for that refresh — no error, no log, just fewer alerts. One
// retry against a fresh connection almost always lands on a healthy edge.
//
// Behavior is otherwise unchanged: callers still get a Response or a throw.

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_RETRIES = 1; // 2 attempts total

export interface ResilientFetchOptions {
  timeoutMs?: number;
  retries?: number;
}

/**
 * Fetch with a tolerant timeout and one retry. Retries on abort/network error
 * and on 5xx — i.e. exactly the transient conditions that were being silently
 * swallowed. A 4xx is a real answer and is returned as-is, not retried.
 */
export async function resilientFetch(
  url: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES }: ResilientFetchOptions = {}
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status >= 500 && attempt < retries) continue; // transient upstream
      return res;
    } catch (err) {
      lastError = err;
      // AbortError (our timeout) or a TypeError from the network layer. A fresh
      // attempt re-resolves and re-connects, usually to a different edge.
      if (attempt === retries) break;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`resilientFetch failed for ${url}`);
}

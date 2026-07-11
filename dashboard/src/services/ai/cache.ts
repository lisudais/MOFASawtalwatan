// Shared 10-minute TTL cache for AI analysis results, keyed by whatever
// identity the caller considers "the same country/event" (e.g. a disaster id,
// `countryCode|disease`, a security profile's countryCode, an economy
// indicator key). Centralizing this here (instead of a per-service Map, as
// disasterAi/healthAi/economyAi each used to have) means every AI panel gets
// the same expiry behavior and reopening the same item never re-hits the LLM
// within the window.

const TTL_MS = 10 * 60 * 1000;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

export function getCachedAi<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function setCachedAi<T>(key: string, value: T): void {
  store.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

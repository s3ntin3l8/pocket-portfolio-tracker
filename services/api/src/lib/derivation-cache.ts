/**
 * Derivation cache for read-serving endpoints whose computation is expensive and whose
 * data only changes through write operations (POST/PUT/PATCH/DELETE). Caches the
 * *promise* (not just the resolved value) so concurrent requests within the TTL window
 * collapse onto one computation instead of each re-querying independently — the same
 * shape of win as `React.cache()` on the web side, but time-bounded rather than
 * request-scoped since this process serves many requests.
 *
 * All caches share a single TTL and are cleared together via {@link clearDerivationCache},
 * called from the global `onResponse` hook after any non-GET request.
 */

const DERIVATION_CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

const stores = new Set<Map<string, CacheEntry<unknown>>>();

export function createStore<T>(): Map<string, CacheEntry<T>> {
  const store = new Map<string, CacheEntry<T>>();
  stores.add(store as unknown as Map<string, CacheEntry<unknown>>);
  return store;
}

/**
 * Retrieve a cached computation, or compute + cache it if missing / expired.
 *
 * @param cache  The store to use (created by {@link createStore}).
 * @param key    Unique key within the store (e.g. `"${portfolioId}"` or `"${userId}"`).
 * @param compute  Factory for the async computation (only called on cache miss).
 * @param now   Injectable clock for deterministic TTL tests (defaults to `Date.now()`).
 */
export async function withDerivationCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  compute: () => Promise<T>,
  now: number = Date.now(),
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.promise;

  const promise = compute().catch((err) => {
    // A failed computation must not poison the cache — drop it so the next call retries.
    if (cache.get(key)?.promise === (promise as unknown as Promise<T>)) {
      cache.delete(key);
    }
    throw err;
  });
  cache.set(key, { expiresAt: now + DERIVATION_CACHE_TTL_MS, promise } as CacheEntry<T>);
  return promise;
}

/** Drop every cached derivation. Called from the global `onResponse` hook after writes. */
export function clearDerivationCache(): void {
  for (const store of stores) store.clear();
}

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped "FX from cached rates only" switch (audit A7): a read-scoped PAT must never
 * make a GET fetch rates from the FX provider or persist what it returns.
 *
 * The app's onRequest hook opens a scope per request with a lazy check
 * (`() => isReadOnlyPat(request)`), evaluated when an FX load asks — `request.user` is only
 * set later, by the `authenticate` preHandler. `defaultFxProvider()` (services/fx.ts), the
 * default provider of every FX loader, then resolves to `null` (cached-only) for such a
 * request, so a route that never passes a provider is covered too. The derivation caches
 * key a cached-only result apart ({@link cachedOnlyKeySuffix}), so a possibly-degraded
 * result is never served to a session.
 *
 * Kept in its own AsyncLocalStorage, not on the missing-FX store: `captureFxMissing` runs
 * cached computations in a fresh nested store of that one, which would shadow a flag kept
 * there. Same scope mechanics as `runInFxMissingScope` (lib/fx-missing.ts). Outside a
 * request (jobs, services called directly in tests) it is always off.
 */
const scope = new AsyncLocalStorage<() => boolean>();

/** Run `fn` with `isCachedOnly` as the current request's cached-only check. */
export function runInFxCachedOnlyScope(isCachedOnly: () => boolean, fn: () => void): void {
  scope.run(isCachedOnly, fn);
}

/** True when the current request may only use cached FX rates. */
export function isFxCachedOnly(): boolean {
  return scope.getStore()?.() ?? false;
}

/** Cache-key suffix for a cached-only request's derivations (empty otherwise). */
export function cachedOnlyKeySuffix(): string {
  return isFxCachedOnly() ? ":ro" : "";
}

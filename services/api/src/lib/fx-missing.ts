import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped record of currencies a conversion needed but had no FX rate for
 * (audit B2: a missing rate is never converted 1:1 and never fails the request).
 *
 * The app's onRequest hook opens a scope per request ({@link runInFxMissingScope});
 * every `makeFxRateFn` miss inside it records here, routes exclude the unconvertible
 * rows, and the preSerialization hook attaches the set to the response as
 * `fxMissingCurrencies` (+ the `x-fx-missing-currencies` header). Outside a request
 * (jobs, services called directly in tests) recording is a no-op.
 */
const scope = new AsyncLocalStorage<Set<string>>();

/**
 * Run `fn` inside a fresh scope. Called from a callback-style onRequest hook as
 * `runInFxMissingScope(done)`: `run` only holds the store for `fn`'s synchronous
 * execution, but Fastify's `done()` synchronously invokes the next hook and, from there,
 * schedules the rest of the lifecycle — and every async continuation (promise, timer,
 * I/O callback) CREATED inside `run` keeps the store it was created under. So the
 * handler, its awaits and `preSerialization` all see this request's set, while
 * concurrent requests each get their own. This is the shape `@fastify/request-context`
 * uses (`als.run(store, () => done())`). Covered end to end by
 * `test/routes/fx-missing.test.ts`, which asserts the header and body field.
 */
export function runInFxMissingScope(fn: () => void): void {
  scope.run(new Set<string>(), fn);
}

/** Record currencies with no FX rate into the current scope (no-op outside one). */
export function recordFxMissing(currencies: Iterable<string>): void {
  const store = scope.getStore();
  if (!store) return;
  for (const c of currencies) store.add(c);
}

/** The current scope's missing currencies, sorted (empty outside a scope). */
export function currentFxMissing(): string[] {
  return [...(scope.getStore() ?? [])].sort();
}

/**
 * Run `fn` in its own nested scope and return what it recorded — for computations whose
 * result is cached across requests, so the misses can be replayed into every later
 * request that reads the cached value (see `withDerivationCache`).
 */
export async function captureFxMissing<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; missing: string[] }> {
  const inner = new Set<string>();
  const value = await scope.run(inner, fn);
  return { value, missing: [...inner].sort() };
}

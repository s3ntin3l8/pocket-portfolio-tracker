/** Per-request ceiling for every provider HTTP call (audit D10). */
export const PROVIDER_FETCH_TIMEOUT_MS = 10_000;

/**
 * Wrap a `fetch` so every call carries `AbortSignal.timeout(timeoutMs)` unless the caller
 * already supplied a `signal`. A hung upstream then rejects (and the service falls through
 * to the next provider) instead of pinning the request — and a refresh run — forever.
 */
export function withTimeout(
  doFetch: typeof fetch,
  timeoutMs: number = PROVIDER_FETCH_TIMEOUT_MS,
): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    doFetch(
      input,
      init?.signal ? init : { ...init, signal: AbortSignal.timeout(timeoutMs) },
    )) as typeof fetch;
}

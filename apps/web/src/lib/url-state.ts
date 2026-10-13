/**
 * Shallow URL-state write for purely client-side view state (e.g. the hero chart range):
 * `history.replaceState` updates the address bar and Next's `useSearchParams` without a
 * navigation, a server round-trip, or a new history entry — so the back button is
 * unaffected (a scope change, by contrast, is a `router.push`). `value === null` removes
 * the param (the default view keeps a clean URL). Existing history state is passed through
 * so the Next router's own bookkeeping survives.
 */
export function replaceUrlParam(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (value === null) url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    return;
  }
  window.history.replaceState(window.history.state, "", next);
}

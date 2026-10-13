/**
 * Collect the `fxMissingCurrencies` of several API payloads (any may be null/undefined),
 * deduplicated and sorted — for a page that renders several responses.
 *
 * Deliberately a plain module (no `"use client"`): server components call this at render
 * time, and a function exported from a client module cannot be invoked on the server —
 * React throws "Attempted to call collectFxMissing() from the server" (audit B2 follow-up).
 * The banner that displays the result lives in `components/fx-missing-banner.tsx`.
 */
export function collectFxMissing(
  ...sources: ({ fxMissingCurrencies?: string[] | null } | null | undefined | string[])[]
): string[] {
  const out = new Set<string>();
  for (const s of sources) {
    if (!s) continue;
    const list = Array.isArray(s) ? s : (s.fxMissingCurrencies ?? []);
    for (const c of list) out.add(c);
  }
  return [...out].sort();
}

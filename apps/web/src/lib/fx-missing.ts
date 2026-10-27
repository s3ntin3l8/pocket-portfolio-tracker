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

/** The two fields of a holding the FX predicates read (structural, so any valuation row fits). */
interface FxFlagged {
  valuedAtCost?: boolean;
  fxMissing?: boolean;
  marketValueDisplay: string | null;
}

/**
 * `fxMissing` is OR-merged across depots on the all-portfolios view, while the display figures
 * are the sums of the depots that could convert. A flagged row with NO display value is wholly
 * excluded (shown "No FX rate", P&L "—", out of every total); a flagged row that still has one is
 * PARTIAL: its figures are real and counted, only a depot's share is left out (#1181). Every
 * surface that counts or lists FX-affected holdings goes through these two, so the hero banner,
 * the table footnote and the P&L cells cannot drift apart.
 */
export const noDisplayFigures = (h: FxFlagged): boolean =>
  Boolean(h.fxMissing && h.marketValueDisplay === null);
export const fxPartial = (h: FxFlagged): boolean =>
  Boolean(h.fxMissing && h.marketValueDisplay !== null);

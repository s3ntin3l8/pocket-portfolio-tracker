/** Relative tolerance for quantity/price equality (0.2%). Comfortably absorbs a
 *  precision/rounding divergence (`74.506` vs `74.51` is 0.005%) while keeping two
 *  genuinely different same-day buys (e.g. 1.3358 vs 3.1399 units) far apart. */
export const REL_TOL = 0.002;
/** Absolute floor so sub-unit quantities/prices (a 0.34-unit fund buy) still match
 *  when their relative difference would otherwise be large. */
export const ABS_TOL = 0.0005;
export const DAY_MS = 86_400_000;

/** Acquisition actions that are the *same* economic event under different source labels.
 *  Deliberately narrow — `sell` is an acquisition's opposite, never a dedup peer.
 *  `bonus` is included so a perk-funded buy that one source collapses into a `bonus`
 *  free-share row still dedups against the same trade arriving as a plain `buy` from
 *  another source (CSV-collapsed bonus vs. live-synced buy of the same shares). */
export const ACQUISITION_ACTIONS = new Set(["buy", "savings_plan", "bonus"]);

/** Richness rank used by recomputeRollup. Higher = wins over lower. */
export const SOURCE_RANK: Record<string, number> = {
  manual: 100,
  pdf: 40,
  pytr: 30,
  ibkr: 25, // IBKR Flex XML: richer than plain CSV but no settlement PDFs
  csv: 20,
  screenshot: 10,
};

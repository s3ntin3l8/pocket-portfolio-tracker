/**
 * Shared sanity-gate thresholds for data-artifact guards across the core package.
 *
 * These guard daily/period moves that exceed plausible market behavior — when a
 * stale previousClose, missing corporate action, or upstream API unit mismatch
 * produces a return that no real instrument would have.  Without the guard, a
 * single bad price contaminates every portfolio-level metric that aggregates
 * it (totalDayChange, TWR, mover cards, drawdown).
 *
 * All values are absolute percentages (0–100), not decimals.  The thresholds
 * are tuned for diversified multi-holding books:
 *
 *   - SINGLE_DAY_MAX_PCT (50%):  Concentrated single-name books can see real
 *     >50% days (takeover gap, limit move, M&A close).  Callers serving
 *     single-stock portfolios should pass a per-caller override.
 *   - PERIOD_GAIN_MAX_PCT (200%): Monthly/yearly movers >3x are almost
 *     certainly a data artifact (stale price, missing split adjustment).
 *   - PERIOD_LOSS_MAX_PCT (90%):  A long-only equity cannot lose more than
 *     100%, so a >90% monthly/yearly loss is near-total wipeout and likely
 *     a unit-mismatch artifact (price → 0).
 *   - MAX_PRICE_CARRY_FORWARD_DAYS (10): a "latest price on or before date X"
 *     lookup that finds nothing within this window is treated as NO price,
 *     not a plausible last-known value — beyond ~2 trading weeks (covers
 *     ordinary weekends/holidays with room to spare) a price feed that has
 *     stopped updating for an instrument should exclude it from movers/
 *     concentration weighting rather than silently reporting a stale 0.00%
 *     move or an outdated weight.
 */

export const SINGLE_DAY_MAX_PCT = 50;
export const PERIOD_GAIN_MAX_PCT = 200;
export const PERIOD_LOSS_MAX_PCT = 90;
export const MAX_PRICE_CARRY_FORWARD_DAYS = 10;

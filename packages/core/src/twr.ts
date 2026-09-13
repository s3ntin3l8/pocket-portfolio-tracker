/**
 * Time-weighted return (TWR) calculation for portfolio performance charts.
 *
 * TWR formula per day t:
 *   1 + r_t = (V_t − effectiveFlow_t) / V_{t-1}
 *   Index_t = Index_{t-1} · (1 + r_t)   base 100; pct = index/base − 1
 *
 * V = holdings MARKET VALUE only (not net worth — robust to unrecorded cash).
 * effectiveFlow_t = buysCost − sellsProceeds − income(realSeries only)
 *   = -Σ cashFlow(tx) for buy/savings_plan/sell + income(realSeries) on day t
 *
 * Split-adjustment: store RAW closes in prices; adjust at read time:
 *   adjustedClose(d) = rawClose(d) / splitAdjustmentFactor(cas, id, d)
 * where the factor is the product of ratios for CAs with exDate > d.
 */
import type { Decimal } from "decimal.js";
import { D, ZERO } from "./decimal.js";
import { isTradeType } from "./categorization.js";
import { computeHoldings, marketValue } from "./holdings.js";
import { cashFlow } from "./cash.js";
import { SINGLE_DAY_MAX_PCT } from "./sanity-gates.js";
import { convert, type FxRateFn } from "./networth.js";
import { toDateKey } from "./date-utils.js";
import type { CoreTransaction, CorporateAction } from "./types.js";

/** Classification of an instrument's price series for income-netting decisions. */
export type PriceSeriesKind =
  /** Real exchange-listed series: price drops on ex-date → net income OUT. */
  | "realSeries"
  /** Flat proxy (bond par / NAV carried-back flat): income NOT netted — would manufacture fake gain. */
  | "flatProxy"
  /** No price (instrument-less interest): excluded from V and flows. */
  | "none";

/** Per-date holdings market value and effective capital flow, in `baseCurrency`. */
export interface DailyValueFlow {
  date: string; // YYYY-MM-DD
  /** Sum of priced holdings market value in baseCurrency. */
  marketValue: string;
  /**
   * Effective capital flow = buysCost − sellsProceeds − income(realSeries only).
   * Equals -Σ cashFlow(tx) for buy/savings_plan/sell/realSeries-income txns on this day.
   * FX-converted to baseCurrency at the day's rate.
   */
  effectiveFlow: string;
}

/** A single point on the chained TWR index series. */
export interface IndexPoint {
  date: string; // YYYY-MM-DD
  /** Chained total-return index, base 100. */
  index: string;
  /** (index/100 − 1) × 100: percentage return since inception. */
  pct: string;
}

/**
 * Split-adjustment factor for a price on a given date.
 *
 * adjustedClose(d) = rawClose(d) / splitAdjustmentFactor(cas, id, d)
 *
 * Product of ratios for CAs with exDate STRICTLY AFTER d.
 * ratioOf(split) = ratio; ratioOf(bonus) = 1 + ratio; rights = no-op.
 */
export function splitAdjustmentFactor(
  cas: CorporateAction[],
  instrumentId: string,
  date: string,
): Decimal {
  let factor = D(1);
  for (const ca of cas) {
    if (ca.instrumentId !== instrumentId) continue;
    const caDate = ca.exDate instanceof Date ? toDateKey(ca.exDate) : String(ca.exDate);
    if (caDate > date) {
      if (ca.type === "split") {
        factor = factor.mul(D(ca.ratio));
      } else if (ca.type === "bonus") {
        factor = factor.mul(D(1).add(D(ca.ratio)));
      }
      // rights: no price adjustment
    }
  }
  return factor;
}

export interface BuildDailyValueFlowsInput {
  transactions: CoreTransaction[];
  corporateActions: CorporateAction[];
  /** YYYY-MM-DD strings, sorted ascending. */
  dates: string[];
  /**
   * Returns the split-adjusted close and its native currency for an instrument on a date.
   * Return null if the instrument has no price on that date (excluded from MV).
   */
  priceAt: (instrumentId: string, date: string) => { close: string; currency: string } | null;
  /** Returns an FxRateFn for converting any currency to baseCurrency on the given date. */
  fxAt: (date: string) => FxRateFn;
  baseCurrency: string;
  /** Returns the price-series classification for the instrument. */
  kindOf: (instrumentId: string) => PriceSeriesKind;
  /**
   * Maps a transaction to the date (YYYY-MM-DD) its flow should be attributed to.
   * Defaults to tx.executedAt (YYYY-MM-DD). Override to map dividend/coupon txns
   * to their ex-date for accurate income-netting.
   */
  flowDateOf?: (tx: CoreTransaction) => string;
}

/**
 * Build the per-day (marketValue, effectiveFlow) series for a portfolio.
 * Pure — no DB access. The caller injects split-adjusted prices and FX rates.
 */
export function buildDailyValueFlows(input: BuildDailyValueFlowsInput): DailyValueFlow[] {
  const {
    transactions,
    corporateActions,
    dates,
    priceAt,
    fxAt,
    baseCurrency,
    kindOf,
    flowDateOf = (tx) => toDateKey(tx.executedAt),
  } = input;

  // Pre-build a date → transactions map using the (possibly remapped) flow date.
  const flowsByDate = new Map<string, CoreTransaction[]>();
  for (const tx of transactions) {
    const d = flowDateOf(tx);
    const list = flowsByDate.get(d) ?? [];
    list.push(tx);
    flowsByDate.set(d, list);
  }

  const result: DailyValueFlow[] = [];

  for (const date of dates) {
    const fx = fxAt(date);
    // Holdings at end of this date. CAs always applied; txns filtered to ≤ date.
    const asOf = new Date(`${date}T23:59:59.999Z`);
    const holdings = computeHoldings(transactions, corporateActions, asOf);

    // Market value: Σ qty × adjustedClose × FX, skipping unpriced instruments.
    let mv = ZERO;
    for (const h of holdings) {
      if (D(h.quantity).isZero()) continue;
      const p = priceAt(h.instrumentId, date);
      if (p === null) continue;
      const holdingMv = marketValue(h.quantity, p.close);
      mv = mv.add(D(convert(holdingMv, p.currency, baseCurrency, fx)));
    }

    // Effective flow: -Σ cashFlow(tx) for qualifying txns whose flow lands on this date.
    let flow = ZERO;
    const dayTxns = flowsByDate.get(date) ?? [];
    for (const tx of dayTxns) {
      const { type } = tx;
      if (isTradeType(type)) {
        // effectiveFlow -= cashFlow(tx)
        // buy: cashFlow < 0 → -cashFlow > 0 (cost added to flow)
        // sell: cashFlow > 0 → -cashFlow < 0 (proceeds subtracted from flow)
        const cf = cashFlow(tx);
        flow = flow.sub(D(convert(cf.toString(), tx.currency, baseCurrency, fx)));
      } else if ((type === "dividend" || type === "coupon") && tx.instrumentId) {
        // Only net income for realSeries — flatProxy price doesn't drop on ex-date.
        if (kindOf(tx.instrumentId) === "realSeries") {
          const cf = cashFlow(tx);
          flow = flow.sub(D(convert(cf.toString(), tx.currency, baseCurrency, fx)));
        }
      }
      // deposit/withdrawal/fee/interest/loan_*/split/bonus/rights:
      // don't affect holdings MV → no effectiveFlow contribution.
    }

    result.push({
      date,
      marketValue: mv.toString(),
      effectiveFlow: flow.toString(),
    });
  }

  return result;
}

const BASE = 100;

/**
 * Chain the TWR index from a (marketValue, effectiveFlow) series.
 * V_{t-1} = 0: r_t = 0, index carries forward (no reset).
 *
 * Guards against data artifacts:
 * - r_t ≤ −1 (a ≥100% single-day loss): carried forward — a held, long-only position
 *   cannot legitimately lose 100%+ of its value in one day; this only happens when a
 *   snapshot's marketValue was recorded as ~0 with no offsetting flow (a stale/missing
 *   price, not a real return).  Applying it would multiply the index by ≤0, permanently
 *   zeroing (or flipping the sign of) every subsequent point.
 * - |r_t| > MAX_SINGLE_DAY_RETURN (default SINGLE_DAY_MAX_PCT, 50%): also carried
 *   forward — a diversified portfolio cannot gain or lose more than 50% in a single
 *   day; values beyond this threshold indicate a stale/missing price in one or more
 *   snapshots that would otherwise corrupt the entire index chain, drawdown, and
 *   volatility metrics.
 *
 * Caveat: SINGLE_DAY_MAX_PCT is tuned for diversified multi-holding books.  Concentrated
 * single-name portfolios can see real >50% days (takeover gap, limit move, M&A close)
 * — those days will be silently dropped, and TWR/drawdown will understate the move.
 * Callers serving single-stock portfolios should pass a per-caller override.
 */
export function chainIndex(
  series: DailyValueFlow[],
  base = BASE,
  maxSingleDayReturn: number = SINGLE_DAY_MAX_PCT / 100,
): IndexPoint[] {
  const result: IndexPoint[] = [];
  let index = D(base);
  let prevMv: Decimal | null = null;

  for (const point of series) {
    const mv = D(point.marketValue);
    const flow = D(point.effectiveFlow);

    if (prevMv !== null && !prevMv.isZero()) {
      // r_t = (V_t − flow_t) / V_{t-1} − 1
      const rt = mv.sub(flow).div(prevMv).sub(1);
      const growth = D(1).add(rt);
      // Guard: growth ≤ 0 (≥100% loss) or |rt| > threshold (suspect single-day move).
      // Both indicate data artifacts (stale/missing prices), not real returns.
      if (growth.gt(0) && rt.abs().lte(maxSingleDayReturn)) {
        index = index.mul(growth);
      } else if (typeof process !== "undefined" && process.stderr) {
        // Log dropped days so artifact prices become visible in logs instead of
        // silently vanishing — aids debugging stale/missing price data.
        process.stderr.write(
          JSON.stringify({
            level: "warn",
            msg: "[twr] dropped artifact day",
            date: point.date,
            rt: rt.toString(),
            reason: growth.lte(0) ? "negative_growth" : "exceeds_max_single_day_return",
          }) + "\n",
        );
      }
    }
    // prevMv === null: first point, index stays at base.
    // prevMv.isZero(): reset-proof carry-forward (index unchanged).

    const pct = index.div(base).sub(1).mul(100);
    result.push({ date: point.date, index: index.toString(), pct: pct.toString() });
    prevMv = mv;
  }
  return result;
}

/**
 * Sum per-portfolio (marketValue, effectiveFlow) series across portfolios per date, over the
 * UNION of dates any portfolio has a point on, then sort by date. Use this before `chainIndex`
 * for the aggregate view — you cannot average per-portfolio indices.
 *
 * Each portfolio's own series is sanitized against its own history BEFORE summing (not after,
 * unlike `chainIndex`'s aggregate-level guard) — a single portfolio's data artifact must not
 * corrupt every other portfolio's genuine return on the same day:
 *
 * - **Missing row** (no point for this portfolio on a date another portfolio has a point on):
 *   carry the portfolio's last known value forward, contributing zero flow. Before the
 *   portfolio's first-ever point it contributes nothing at all (unchanged from prior
 *   behaviour) — that is not a gap, the portfolio simply doesn't exist yet.
 * - **Present but implausible row** (day-over-day change exceeds `maxSingleDayReturn` given
 *   the row's own recorded flow — same threshold `chainIndex` uses): also carried forward, and
 *   the row's flow is dropped too — a bad row's flow isn't trustworthy either. This is what a
 *   stale/missing price for a single instrument in one portfolio looks like (e.g. a snapshot
 *   recorded at a small fraction of its true value that later recovers).
 * - **Present, implausible, AND exactly zero**: treated as a genuine termination (the position
 *   was liquidated, or its transactions were deleted/moved out) rather than a data artifact —
 *   the prior value is booked as an *outflow* on this date instead of carried forward, so the
 *   portfolio's disappearance from the aggregate is flow-neutral rather than read as a −100%
 *   return. A later reappearance (this leg's value coming back from zero) is accepted
 *   unconditionally, mirroring `chainIndex`'s own reset-proof handling of `prevMv.isZero()`.
 * - **Implausible for more than MAX_IMPLAUSIBLE_STREAK consecutive days**: the carried-forward
 *   anchor is deliberately never updated on a single implausible day (so a one-day glitch that
 *   recovers doesn't drag the baseline along with it), but that alone would freeze a leg forever
 *   if it never lands back within range of the pre-glitch anchor — a genuine large move, or a
 *   price feed resuming at a rebased level, would never be re-accepted. After the streak limit,
 *   the current value is accepted as the new baseline unconditionally.
 */
export function aggregateValueFlows(
  perPortfolio: DailyValueFlow[][],
  maxSingleDayReturn: number = SINGLE_DAY_MAX_PCT / 100,
): DailyValueFlow[] {
  const dates = [...new Set(perPortfolio.flatMap((series) => series.map((p) => p.date)))].sort();

  const byDate = new Map<string, { mv: Decimal; flow: Decimal }>();
  for (const date of dates) byDate.set(date, { mv: ZERO, flow: ZERO });

  // A leg stuck rejecting every day against a stale anchor would freeze forever if a
  // genuine, sustained move (a correction, a provider fix, a real rebase) never lands
  // back within range of that old anchor — see MAX_IMPLAUSIBLE_STREAK below.
  //
  // Deliberate trade-off: once the streak limit is hit, a leg still frozen on genuinely
  // bad data (not a real move) will un-freeze into that bad value instead of staying
  // frozen. Bounded wrongness (at most this many days of an artifact reaching the
  // aggregate) was chosen over unbounded freezing (a leg silently vanishing from the
  // aggregate forever) — do not "fix" this back to freezing indefinitely.
  const MAX_IMPLAUSIBLE_STREAK = 3;

  for (const series of perPortfolio) {
    const byRawDate = new Map(series.map((p) => [p.date, p]));
    let lastGoodMv: Decimal | null = null;
    let implausibleStreak = 0;

    for (const date of dates) {
      const raw = byRawDate.get(date);
      const entry = byDate.get(date)!;

      if (!raw) {
        // No point for this portfolio today. Carry its last known value forward once it
        // exists; before its first-ever point it simply isn't part of the aggregate yet.
        if (lastGoodMv !== null) entry.mv = entry.mv.add(lastGoodMv);
        continue;
      }

      const mv = D(raw.marketValue);
      const flow = D(raw.effectiveFlow);

      if (lastGoodMv === null || lastGoodMv.isZero()) {
        // First point ever for this leg, or resuming after a termination: no meaningful
        // prior baseline to sanity-check against (dividing by zero) — accept as-is.
        entry.mv = entry.mv.add(mv);
        entry.flow = entry.flow.add(flow);
        lastGoodMv = mv;
        implausibleStreak = 0;
        continue;
      }

      const rt = mv.sub(flow).div(lastGoodMv).sub(1);
      const growth = D(1).add(rt);
      const plausible = growth.gt(0) && rt.abs().lte(maxSingleDayReturn);

      if (plausible) {
        entry.mv = entry.mv.add(mv);
        entry.flow = entry.flow.add(flow);
        lastGoodMv = mv;
        implausibleStreak = 0;
      } else if (mv.isZero()) {
        // Genuine termination: book the prior value as an outflow rather than as a return.
        entry.flow = entry.flow.sub(lastGoodMv);
        lastGoodMv = ZERO;
        implausibleStreak = 0;
      } else {
        implausibleStreak++;
        if (implausibleStreak > MAX_IMPLAUSIBLE_STREAK) {
          // Sustained implausibility relative to the OLD anchor is more likely a genuine
          // new price level than an ongoing artifact — accept it as the new baseline
          // rather than freezing this leg's contribution forever. Without this, a
          // multi-day gap that resolves to a value outside ±50% of the pre-gap anchor
          // (a real large move, or the price feed resuming at a rebased level) would
          // never recover.
          entry.mv = entry.mv.add(mv);
          entry.flow = entry.flow.add(flow);
          lastGoodMv = mv;
          implausibleStreak = 0;
        } else {
          // Implausible non-zero value: a data artifact. Carry the last known value
          // forward and drop this row's flow — an untrustworthy row's flow isn't
          // trustworthy either.
          entry.mv = entry.mv.add(lastGoodMv);
        }
      }
    }
  }

  return dates.map((date) => {
    const { mv, flow } = byDate.get(date)!;
    return { date, marketValue: mv.toString(), effectiveFlow: flow.toString() };
  });
}

/** Alias: chain-index the summed aggregate flows. Same as chainIndex. */
export const chainAggregateIndex = chainIndex;

import { Decimal } from "decimal.js";
import { D } from "./decimal.js";
import { isAcquisitionType, isTransferType } from "./categorization.js";
import { convert, type FxRateFn } from "./networth.js";
import { toDateKey } from "./date-utils.js";
import type { CoreTransaction } from "./types.js";

/**
 * Acquisition `kind`s that are NOT the user's own external money and therefore
 * never count as a contribution, even though they buy shares (broker-credited
 * reinvestment). `roundup` is deliberately NOT here — round-ups are the user's
 * own spare change. `reinvestment` is a dividend reinvestment (TR "Reinvestition
 * der Dividende") booked as a `buy` funded by the dividend (return), not external
 * capital — so it's excluded here while still building the average-cost pool.
 * `merger` is the buy leg of a fund merger (Fondsverschmelzung): the new shares
 * replace old ones rather than being newly-funded, so they are not contributed
 * capital (its sell leg is likewise kept out of `outflow` — see {@link outsideDays}).
 */
const EXCLUDED_ACQUISITION_KINDS = new Set(["saveback", "merger", "reinvestment", "crypto_bonus"]);

export interface ContributionInput {
  txns: CoreTransaction[];
  displayCurrency: string;
  fx?: FxRateFn;
  now?: Date;
  /**
   * Where this portfolio's investment boundary sits (see CLAUDE.md "one boundary
   * per portfolio"). Each boundary counts exactly one side, never both — which is
   * what avoids double-counting the same money.
   * - "inside" (cash counts — Tagesgeld/Festgeld/savings depot): contribution is
   *   net external cash, `deposit − withdrawal` per month. Buys are internal
   *   reallocations of cash already inside the boundary and never count.
   * - "outside" (cash excluded — mixed/checking, invest-only): contribution is net
   *   invested capital — externally-funded acquisitions (`buy`/`savings_plan`, and
   *   `transfer_in` share transfers) at cost, minus sells at average cost. Income
   *   (dividend/coupon/interest) and broker-credited reinvestment (`saveback`,
   *   bonus shares) are return, never contribution.
   */
  boundary?: "inside" | "outside";
}

export interface ContributionStats {
  displayCurrency: string;
  totalContributed: string;
  totalWithdrawn: string;
  netContributed: string;
  /** Count of calendar months from the first contribution month through the current
   * month (inclusive). Used as the denominator for monthlyAverage so idle months
   * dilute the average correctly. */
  monthsElapsed: number;
  /** Count of distinct calendar months that had non-zero net contribution activity.
   * Kept for existing consumers; use monthsElapsed for the per-month average. */
  monthsActive: number;
  /** Net contribution divided by monthsElapsed (all months since first transaction). */
  monthlyAverage: string;
  /** Net contribution per calendar month, ascending by `month` (YYYY-MM). */
  series: { month: string; contributed: string }[];
  /** Net contribution per calendar DAY, ascending by `date` (YYYY-MM-DD). Day-resolution
   * companion to `series`; `series` is the month rollup of these same buckets. Used by the
   * overlay chart so the contributed step lands on the actual transaction day. */
  dailySeries: { date: string; contributed: string }[];
}

interface FlowAgg {
  inflow: Decimal;
  outflow: Decimal;
}

/** UTC year-month-day bucket key, e.g. "2026-06-28". Day resolution so the contributed
 * step aligns with the daily value series (`portfolioSnapshots.date` is likewise UTC). */
const dayKey = toDateKey;

/**
 * Count of inclusive calendar months from `firstKey` ("YYYY-MM") through the
 * month containing `now`. Returns at least 1 so the denominator is never zero.
 * Example: first="2025-08", now=2026-06 → (2026-2025)*12 + (6-8) + 1 = 11 months.
 */
function elapsedMonths(firstKey: string, now: Date): number {
  const [fy, fm] = firstKey.split("-").map(Number);
  const ny = now.getUTCFullYear();
  const nm = now.getUTCMonth() + 1; // 1-based
  return Math.max(1, (ny - fy) * 12 + (nm - fm) + 1);
}

/** Cash amount of a deposit landing inside the boundary (fees reduce what lands). */
function depositInflow(tx: CoreTransaction, fx: FxRateFn, display: string): Decimal {
  const amount = D(tx.price).sub(D(tx.fees));
  return D(convert(amount.toString(), tx.currency, display, fx));
}

/** Outflow magnitude of a withdrawal (cash leaving, including fees). */
function withdrawalOutflow(tx: CoreTransaction, fx: FxRateFn, display: string): Decimal {
  const amount = D(tx.price).add(D(tx.fees));
  return D(convert(amount.toString(), tx.currency, display, fx));
}

/** Whether an acquisition is the user's own external capital (outside boundary). */
function isExternalAcquisition(tx: CoreTransaction): boolean {
  // Reward-funded (cash_neutral) acquisitions still build the cost-basis pool but are
  // not the user's own capital — never a contribution.
  if (tx.status === "cash_neutral") return false;
  if (tx.kind && EXCLUDED_ACQUISITION_KINDS.has(tx.kind)) return false;
  if (isAcquisitionType(tx.type)) return true;
  // First-class transfer_in: shares owned elsewhere arrive at carried cost.
  // They represent capital the user already deployed — count as contributed.
  if (tx.type === "transfer_in") return true;
  // `bonus` rows are zero-cash share receipts (corporate actions, reinvested
  // dividends) — only a legacy transfer_in-tagged row is contributed capital.
  if (tx.type === "bonus") return tx.kind === "transfer_in";
  return false;
}

/**
 * Cash amount of a securities transfer landing inside the boundary (at carried cost).
 * Fees add to the carried basis, same as an acquisition's cost basis (`qty × price + fees`)
 * — a transfer's fee is a real cost incurred to move the shares, not something that
 * reduces what "landed".
 */
function transferInflow(tx: CoreTransaction, fx: FxRateFn, display: string): Decimal {
  const gross = D(tx.quantity).abs().mul(D(tx.price)).add(D(tx.fees));
  return D(convert(gross.toString(), tx.currency, display, fx));
}

/**
 * A single dated, signed cash-flow crossing the boundary, in XIRR convention: negative =
 * capital entering the boundary (a contribution), positive = capital leaving it (a
 * withdrawal/return of capital). This is the per-transaction view of the same walk
 * {@link insideDays}/{@link outsideDays} do at day resolution — kept in lockstep with
 * them (see {@link walkInsideDays}/{@link walkOutsideDays}) so contributions and the
 * transfer valuation both come from one boundary walk, never two divergent ones.
 * `isTransfer` tags points sourced from `transfer_in`/`transfer_out` (or the legacy
 * `bonus`+`kind:"transfer_in"` pattern) so {@link transferFlowPoints} can pull just
 * those out — the walk's cost-basis valuation for a transfer is correct for every
 * consumer, but its cost-basis valuation of a `sell` (used for contribution tracking)
 * is NOT the same thing a cash-flow-based consumer like XIRR needs (that wants sale
 * proceeds, not cost-of-sold) — see `services/api`'s `flows.ts` for how the two are
 * composed back together.
 */
interface FlowPoint {
  date: Date;
  amount: Decimal;
  isTransfer: boolean;
}

interface DayWalkResult {
  days: Map<string, FlowAgg>;
  points: FlowPoint[];
}

/**
 * Walks the INSIDE-boundary rules (net external cash) once, producing both the
 * day-bucketed view {@link insideDays} needs and the per-transaction point view
 * {@link boundaryFlowPoints} needs — same amounts, same inclusion rules, two shapes.
 */
function walkInsideDays(txns: CoreTransaction[], fx: FxRateFn, display: string): DayWalkResult {
  const months = new Map<string, FlowAgg>();
  const points: FlowPoint[] = [];
  for (const tx of txns) {
    const key = dayKey(tx.executedAt);
    const m = months.get(key) ?? { inflow: D(0), outflow: D(0) };
    if (tx.type === "deposit") {
      const amount = depositInflow(tx, fx, display);
      m.inflow = m.inflow.add(amount);
      points.push({ date: tx.executedAt, amount: amount.neg(), isTransfer: false });
    } else if (tx.type === "withdrawal") {
      const amount = withdrawalOutflow(tx, fx, display);
      m.outflow = m.outflow.add(amount);
      points.push({ date: tx.executedAt, amount, isTransfer: false });
    } else if (tx.type === "transfer_in") {
      // Inbound transfer: shares arrive at carried cost — that value crosses the boundary
      // as contributed capital (same logic as a deposit for an inside-boundary portfolio).
      const amount = transferInflow(tx, fx, display);
      m.inflow = m.inflow.add(amount);
      points.push({ date: tx.executedAt, amount: amount.neg(), isTransfer: true });
    } else if (tx.type === "transfer_out") {
      // Outbound transfer: capital leaves the boundary at carried cost basis.
      const amount = transferInflow(tx, fx, display);
      m.outflow = m.outflow.add(amount);
      points.push({ date: tx.executedAt, amount, isTransfer: true });
    } else {
      continue;
    }
    months.set(key, m);
  }
  return { days: months, points };
}

/** Per-day {inflow, outflow} when cash is INSIDE the boundary: net external cash. */
function insideDays(txns: CoreTransaction[], fx: FxRateFn, display: string): Map<string, FlowAgg> {
  return walkInsideDays(txns, fx, display).days;
}

/**
 * Per-day {inflow, outflow} when cash is OUTSIDE the boundary: net invested
 * capital. Inflow = externally-funded acquisitions at cost; outflow = sells at
 * running average cost (so the cumulative net equals the cost basis still
 * deployed, pairing correctly with the securities-only value used downstream).
 * All real acquisitions (incl. broker-credited ones) build the average-cost pool;
 * only externally-funded ones count toward `inflow`.
 */
function walkOutsideDays(txns: CoreTransaction[], fx: FxRateFn, display: string): DayWalkResult {
  const sorted = [...txns].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
  // Pool is denominated in costCurrency (the trade currency of the instrument's
  // buys) — mirror of computeHoldings. Mixing currencies for one instrument is
  // meaningless (cost basis is currency-blind). Rather than crash the entire
  // summary (the original behavior) or skip-and-refund mid-loop, we pre-scan
  // for instruments whose acquisitions span more than one currency and drop
  // them entirely — every tx for that instrument is skipped in the main loop.
  const skippedInstruments = new Set<string>();
  const acquisitionCurrencies = new Map<string, Set<string>>();
  for (const tx of sorted) {
    if (!tx.instrumentId) continue;
    if (
      tx.type !== "buy" &&
      tx.type !== "savings_plan" &&
      tx.type !== "bonus" &&
      tx.type !== "transfer_in"
    )
      continue;
    const set = acquisitionCurrencies.get(tx.instrumentId) ?? new Set<string>();
    set.add(tx.currency);
    acquisitionCurrencies.set(tx.instrumentId, set);
  }
  for (const [instrumentId, ccys] of acquisitionCurrencies) {
    if (ccys.size > 1) {
      skippedInstruments.add(instrumentId);
      process.stderr.write(
        JSON.stringify({
          level: "warn",
          event: "contributions_mixed_currency_instrument",
          instrumentId,
          currencies: [...ccys].sort(),
        }) + "\n",
      );
    }
  }
  const pool = new Map<string, { qty: Decimal; cost: Decimal; costCurrency: string }>();
  const months = new Map<string, FlowAgg>();
  const points: FlowPoint[] = [];

  for (const tx of sorted) {
    if (!tx.instrumentId) continue;
    if (skippedInstruments.has(tx.instrumentId)) continue;
    const key = dayKey(tx.executedAt);
    const m = months.get(key) ?? { inflow: D(0), outflow: D(0) };

    if (
      tx.type === "buy" ||
      tx.type === "savings_plan" ||
      tx.type === "bonus" ||
      tx.type === "transfer_in"
    ) {
      // Acquisitions add to the pool in costCurrency (NOT pre-converted to display).
      // The previous code accumulated in display, which forced a redundant conversion
      // at outflow time using tx.currency (the depot's base) — wrong for cross-currency
      // holdings where buys were priced in a non-base currency.
      const existing = pool.get(tx.instrumentId);
      if (!existing) {
        pool.set(tx.instrumentId, {
          qty: D(0),
          cost: D(0),
          costCurrency: tx.currency,
        });
      }
      const p = pool.get(tx.instrumentId)!;
      const gross = D(tx.quantity).abs().mul(D(tx.price)).add(D(tx.fees));
      p.qty = p.qty.add(D(tx.quantity).abs());
      p.cost = p.cost.add(gross);
      if (isExternalAcquisition(tx)) {
        // Convert from costCurrency to display only at the inflow boundary.
        const amount = D(convert(gross.toString(), tx.currency, display, fx));
        m.inflow = m.inflow.add(amount);
        // isExternalAcquisition only returns true here for transfer_in or the legacy
        // bonus+kind:"transfer_in" pattern (buy/savings_plan are always external and
        // therefore not transfers) — see isExternalAcquisition's own branches.
        const isTransfer =
          isTransferType(tx.type) || (tx.type === "bonus" && tx.kind === "transfer_in");
        points.push({ date: tx.executedAt, amount: amount.neg(), isTransfer });
      }
    } else if (tx.type === "transfer_out") {
      // Outbound transfer removes from the avg-cost pool and counts as outflow
      // (capital leaving the boundary), analogous to a sell but with no P&L.
      const p = pool.get(tx.instrumentId);
      if (!p || p.qty.lte(0)) continue;
      const transferQty = Decimal.min(D(tx.quantity).abs(), p.qty);
      const avg = p.cost.div(p.qty);
      const costOfTransferred = avg.mul(transferQty); // in costCurrency
      p.qty = p.qty.sub(transferQty);
      p.cost = p.cost.sub(costOfTransferred);
      // Convert from costCurrency → display (B4 fix). Previously this used
      // `tx.currency` (= depot base), which double-converted when the pool was in
      // display, or silently zero-converted when the depot base equalled display.
      const amount = D(convert(costOfTransferred.toString(), p.costCurrency, display, fx));
      m.outflow = m.outflow.add(amount);
      points.push({ date: tx.executedAt, amount, isTransfer: true });
    } else if (tx.type === "sell") {
      const p = pool.get(tx.instrumentId);
      const sellQty = p ? Decimal.min(D(tx.quantity).abs(), p.qty) : D(0);
      const avg = p && p.qty.gt(0) ? p.cost.div(p.qty) : D(0);
      const costOfSold = avg.mul(sellQty); // in costCurrency
      if (p) {
        p.qty = p.qty.sub(sellQty);
        p.cost = p.cost.sub(costOfSold);
      }
      // A merger's sell leg removes the old position but returns no capital — the
      // basis moves into the new instrument's buy leg. Draw the pool, skip outflow.
      if (tx.kind !== "merger" && p) {
        const amount = D(convert(costOfSold.toString(), p.costCurrency, display, fx));
        m.outflow = m.outflow.add(amount);
        points.push({ date: tx.executedAt, amount, isTransfer: false });
      }
    }
    months.set(key, m);
  }
  return { days: months, points };
}

/** Per-day {inflow, outflow} when cash is OUTSIDE the boundary: net invested
 * capital. See {@link walkOutsideDays} for the full rules. */
function outsideDays(txns: CoreTransaction[], fx: FxRateFn, display: string): Map<string, FlowAgg> {
  return walkOutsideDays(txns, fx, display).days;
}

/** One dated, signed cash-flow crossing a portfolio's investment boundary, in XIRR
 * convention (negative = contribution, positive = withdrawal/return of capital). */
export interface BoundaryFlowPoint {
  amount: number;
  date: Date;
}

/**
 * Per-transaction view of the SAME boundary walk {@link contributionStats} uses
 * ({@link walkInsideDays}/{@link walkOutsideDays}) — one dated, signed amount per
 * included transaction instead of a day-bucketed total. Values every row the way
 * `contributionStats` does: a `transfer_in` at carried cost, a `transfer_out` at
 * carried cost (inside) / running average cost (outside), a `sell` at cost-of-sold
 * (outside only — contributions track capital still deployed, not cash proceeds).
 *
 * **On the inside boundary this IS the complete, correct XIRR flow list** — deposit/
 * withdrawal/transfer_in/transfer_out are the only rows that ever cross an
 * inside boundary, and cost-basis valuation and cash-received valuation coincide for
 * all four (a deposit's cash-in *is* its cost). Consumers that need the inside
 * boundary's flows for XIRR/`totalReturnPct` can call this directly (as `flows.ts`
 * does).
 *
 * **On the outside boundary this is NOT the XIRR flow list** — a `sell` valued at
 * cost-of-sold discards the realized gain, and dividends aren't part of the walk at
 * all (they're return, never contribution — CLAUDE.md). A cash-flow-based consumer
 * (XIRR, `totalReturnPct`) needs sells at proceeds and dividends included; only the
 * *transfer* rows in this walk are what such a consumer was getting wrong before
 * (valued ≈0 via `cashFlow()` — issue #736). Use {@link transferFlowPoints} to pull
 * just those out and compose them with a proceeds/income-based flow list for the
 * non-transfer rows — see `services/api`'s `flows.ts`.
 */
export function boundaryFlowPoints(
  txns: CoreTransaction[],
  boundary: "inside" | "outside",
  displayCurrency: string,
  fx: FxRateFn,
): BoundaryFlowPoint[] {
  // Archived + draft rows are excluded from every derivation — mirror contributionStats.
  const relevant = txns.filter((t) => t.status !== "archived" && t.status !== "draft");
  const { points } =
    boundary === "outside"
      ? walkOutsideDays(relevant, fx, displayCurrency)
      : walkInsideDays(relevant, fx, displayCurrency);
  return points
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((p) => ({ amount: Number(p.amount.toString()), date: p.date }));
}

/**
 * Just the transfer-sourced points (`transfer_in`/`transfer_out`, or the legacy
 * `bonus`+`kind:"transfer_in"` pattern) from the same boundary walk
 * {@link boundaryFlowPoints} draws on — valued at carried/average cost, which is
 * correct for a transfer on EITHER boundary (a transfer moves shares, not cash; cost
 * basis is the only meaningful "amount" for it). Exists so a cash-flow-based consumer
 * on the outside boundary (XIRR, `totalReturnPct`) can take its non-transfer rows from
 * a proceeds/income-based valuation (`cashFlow()`) and its transfer rows from here,
 * rather than getting transfers wrong (as `cashFlow()` does — issue #736) or getting
 * every other row wrong (as delegating wholesale to {@link boundaryFlowPoints} would).
 */
export function transferFlowPoints(
  txns: CoreTransaction[],
  boundary: "inside" | "outside",
  displayCurrency: string,
  fx: FxRateFn,
): BoundaryFlowPoint[] {
  const relevant = txns.filter((t) => t.status !== "archived" && t.status !== "draft");
  const { points } =
    boundary === "outside"
      ? walkOutsideDays(relevant, fx, displayCurrency)
      : walkInsideDays(relevant, fx, displayCurrency);
  return points
    .filter((p) => p.isTransfer)
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((p) => ({ amount: Number(p.amount.toString()), date: p.date }));
}

/**
 * Derives contribution analytics (total/average money invested, per-month series)
 * from the raw transactions of one portfolio. No state is stored; everything is
 * computed from the source-of-truth transactions. See {@link ContributionInput.boundary}
 * for what counts as a contribution.
 */
export function contributionStats(input: ContributionInput): ContributionStats {
  const fx: FxRateFn = input.fx ?? (() => "1");
  const display = input.displayCurrency;
  const boundary = input.boundary ?? "inside";

  // Archived + draft rows are excluded from every derivation.
  const txns = input.txns.filter((t) => t.status !== "archived" && t.status !== "draft");
  const days =
    boundary === "outside" ? outsideDays(txns, fx, display) : insideDays(txns, fx, display);

  // Day-resolution series: non-zero net days, ascending. Drives the overlay chart so the
  // contributed step lands on the actual transaction day.
  const dailySeries: { date: string; contributed: string }[] = [];
  for (const key of [...days.keys()].sort()) {
    const { inflow, outflow } = days.get(key)!;
    const net = inflow.sub(outflow);
    if (!net.isZero()) dailySeries.push({ date: key, contributed: net.toString() });
  }

  // Roll day buckets up to month buckets — single source of truth, so every monthly stat
  // below is byte-identical to bucketing by month directly (Decimal addition is associative).
  const months = new Map<string, FlowAgg>();
  for (const [day, agg] of days) {
    const mk = day.slice(0, 7);
    const m = months.get(mk) ?? { inflow: D(0), outflow: D(0) };
    m.inflow = m.inflow.add(agg.inflow);
    m.outflow = m.outflow.add(agg.outflow);
    months.set(mk, m);
  }

  let totalContributed = D(0);
  let totalWithdrawn = D(0);
  const series: { month: string; contributed: string }[] = [];

  for (const key of [...months.keys()].sort()) {
    const { inflow, outflow } = months.get(key)!;
    const net = inflow.sub(outflow);
    totalContributed = totalContributed.add(inflow);
    totalWithdrawn = totalWithdrawn.add(outflow);
    if (!net.isZero()) series.push({ month: key, contributed: net.toString() });
  }

  const netContributed = totalContributed.sub(totalWithdrawn);
  const monthsActive = series.length;
  // Use elapsed calendar months (first bucket → now) as the denominator so that
  // idle months dilute the average correctly rather than being silently dropped.
  const now = input.now ?? new Date();
  const firstKey = [...months.keys()].sort()[0];
  const monthsElapsed = firstKey ? elapsedMonths(firstKey, now) : 1;
  const monthlyAverage = firstKey ? netContributed.div(monthsElapsed).toString() : "0";

  return {
    displayCurrency: display,
    totalContributed: totalContributed.toString(),
    totalWithdrawn: totalWithdrawn.toString(),
    netContributed: netContributed.toString(),
    monthsElapsed,
    monthsActive,
    monthlyAverage,
    series,
    dailySeries,
  };
}

/**
 * Merge several portfolios' {@link ContributionStats} (each already computed in the same
 * display currency, possibly under different boundaries) into one aggregate. Per-month net
 * series are summed by month and the totals re-derived — so each portfolio keeps its own
 * boundary instead of being collapsed into one cross-portfolio bucket.
 */
export function mergeContributionStats(
  stats: ContributionStats[],
  displayCurrency: string,
  now?: Date,
): ContributionStats {
  const byMonth = new Map<string, Decimal>();
  const byDay = new Map<string, Decimal>();
  let totalContributed = D(0);
  let totalWithdrawn = D(0);
  for (const s of stats) {
    totalContributed = totalContributed.add(s.totalContributed);
    totalWithdrawn = totalWithdrawn.add(s.totalWithdrawn);
    for (const pt of s.series) {
      byMonth.set(pt.month, (byMonth.get(pt.month) ?? D(0)).add(pt.contributed));
    }
    for (const pt of s.dailySeries) {
      byDay.set(pt.date, (byDay.get(pt.date) ?? D(0)).add(pt.contributed));
    }
  }
  const series = [...byMonth.keys()]
    .sort()
    .map((month) => ({ month, contributed: byMonth.get(month)!.toString() }))
    .filter((pt) => !D(pt.contributed).isZero());
  const dailySeries = [...byDay.keys()]
    .sort()
    .map((date) => ({ date, contributed: byDay.get(date)!.toString() }))
    .filter((pt) => !D(pt.contributed).isZero());
  const netContributed = totalContributed.sub(totalWithdrawn);
  const monthsActive = series.length;
  // Anchor on the earliest month visible in the merged series (note: each portfolio's
  // series is already filtered to non-zero-net months, so the anchor is approximate —
  // an idle first month can shift it forward slightly, which is acceptable).
  const effectiveNow = now ?? new Date();
  const firstKey = [...byMonth.keys()].sort()[0];
  const monthsElapsed = firstKey ? elapsedMonths(firstKey, effectiveNow) : 1;
  const monthlyAverage = firstKey ? netContributed.div(monthsElapsed).toString() : "0";
  return {
    displayCurrency,
    totalContributed: totalContributed.toString(),
    totalWithdrawn: totalWithdrawn.toString(),
    netContributed: netContributed.toString(),
    monthsElapsed,
    monthsActive,
    monthlyAverage,
    series,
    dailySeries,
  };
}

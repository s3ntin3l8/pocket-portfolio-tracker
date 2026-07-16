import { Decimal } from "decimal.js";
import { toDateKey, toMonthKey } from "./date-utils.js";
import { inferIntervalMonths, computeGrowthFactor, addUTCMonths, monthsBetween } from "./growth.js";
import type { IncomeEntry } from "./income.js";

/** A dividend payment projected from last year's actual payout, in instrument currency. */
export interface ProjectedDividend {
  instrumentId: string;
  symbol?: string | null;
  name?: string | null;
  /** YYYY-MM-DD — the projected payment date. */
  date: string;
  /** Total projected cash in `currency`, scaled by quantity change. */
  amount: string;
  currency: string;
  /** Calendar year the estimate is derived from (e.g. 2025 for a 2026 projection). */
  basisYear: number;
  /**
   * How this estimate was derived:
   * - "flat"  — straight replay of historical amount (no growth adjustment)
   * - "grown" — YoY per-share growth factor applied
   */
  source: "flat" | "grown";
  /** The per-share YoY growth multiplier applied when `source === "grown"`. */
  growthApplied?: number;
  /** True when the projected quantity includes assumed continued savings-plan accumulation. */
  assumesContributions?: boolean;
  /**
   * Per-share amount in `currency` (split-adjusted: uses current-share-terms quantities
   * so values are comparable across dates regardless of subsequent corporate actions).
   * Absent for coupons and unlinked rows.
   */
  perShare?: string;
  /** Share count at the projected date (split-adjusted, same basis as `perShare`). */
  quantity?: string;
}

/**
 * Collapse same-instrument, same-type payments into one synthetic payment per calendar
 * month (summing `price`) before either forecast engine below computes a per-share
 * average or infers cadence. Both engines assume one row = one distribution period; a
 * single true distribution can be booked as several small legs (e.g. a US-REIT 1099-DIV
 * recharacterization, where TR reverses and reissues a prior payment across many partial
 * legs within one month) — without this, a month with N correction fragments dilutes the
 * per-share average roughly N-fold instead of counting as the one payment it economically
 * is. A no-op for the normal case of ≤1 payment per instrument per month (every payer that
 * isn't mid-reclassification), so it doesn't change behavior for ordinary history.
 *
 * Representative `executedAt` = the bucket's latest date (the final settled leg, closest
 * to the payment being "done"); other metadata (symbol/name/currency/assetClass) is taken
 * from the bucket's first entry. Keyed by (instrumentId, type, year-month) — `type` keeps
 * dividends and coupons on the same instrument from ever merging.
 */
function bucketMonthly(entries: IncomeEntry[]): IncomeEntry[] {
  const buckets = new Map<string, IncomeEntry[]>();
  for (const e of entries) {
    const yearMonth = toMonthKey(e.executedAt); // YYYY-MM (UTC)
    const key = `${e.instrumentId ?? ""}|${e.type}|${yearMonth}`;
    const list = buckets.get(key);
    if (list) list.push(e);
    else buckets.set(key, [e]);
  }
  const out: IncomeEntry[] = [];
  for (const list of buckets.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const totalPrice = list.reduce((sum, e) => sum.add(new Decimal(e.price)), new Decimal(0));
    const latest = list.reduce((a, b) => (b.executedAt > a.executedAt ? b : a));
    out.push({ ...list[0], executedAt: latest.executedAt, price: totalPrice.toString() });
  }
  return out;
}

/**
 * Project equity dividends for the rest of the current year by replaying
 * each instrument's actual payments from last year's same window (now → Dec 31)
 * shifted forward one year, scaled by the quantity change.
 *
 * Scaling is split-consistent because `qtyAt` should return quantities in
 * current share terms (i.e. with all corporate actions applied regardless of
 * the `asOf` date — see `computeHoldings`).
 *
 * Only instruments still held (`heldQty` with qty > 0) are projected.
 * Instruments with no last-year payment in the window are skipped — they
 * will be covered by announced data once that feature lands.
 *
 * Payments are bucketed to one-per-instrument-per-calendar-month (see
 * `bucketMonthly`) before replay, so a multi-leg correction month counts as one
 * shifted payment rather than N diluted fragments.
 */
export function projectDividends(
  pastDividends: IncomeEntry[],
  heldQty: Map<string, string>,
  qtyAt: (instrumentId: string, at: Date) => string,
  now: Date = new Date(),
  opts: {
    /** Per-instrument monthly share accumulation rate (shares/month). */
    accumulation?: Map<string, string>;
  } = {},
): ProjectedDividend[] {
  // Source window: last year's equivalent of (now, Dec 31].
  const lastYearEnd = new Date(Date.UTC(now.getUTCFullYear() - 1, 11, 31, 23, 59, 59, 999));
  const pastStart = new Date(now);
  pastStart.setUTCFullYear(pastStart.getUTCFullYear() - 1);

  const nowStr = toDateKey(now);

  const out: ProjectedDividend[] = [];
  const bucketed = bucketMonthly(pastDividends);

  for (const e of bucketed) {
    if (e.type !== "dividend" || !e.instrumentId) continue;

    // Filter to the source window (pastStart, lastYearEnd].
    if (e.executedAt <= pastStart || e.executedAt > lastYearEnd) continue;

    // Only project for still-held instruments.
    const currentQtyStr = heldQty.get(e.instrumentId);
    if (!currentQtyStr || new Decimal(currentQtyStr).lte(0)) continue;

    const currentQty = new Decimal(currentQtyStr);
    const histQtyStr = qtyAt(e.instrumentId, e.executedAt);
    const histQty = new Decimal(histQtyStr);

    // Shift date one year forward.
    const projected = new Date(e.executedAt);
    projected.setUTCFullYear(projected.getUTCFullYear() + 1);
    const dateStr = toDateKey(projected);

    // Skip projected dates that aren't strictly in the future.
    if (dateStr <= nowStr) continue;

    // Project ongoing share accumulation (savings plan / regular buys) to the
    // future payment date, mirroring projectNextYearDividends. Without this a
    // year-end payment is understated against today's holding even though the
    // position keeps growing each month.
    const accRate = opts.accumulation
      ? new Decimal(opts.accumulation.get(e.instrumentId) ?? "0")
      : new Decimal(0);
    const hasAccumulation = accRate.gt(0);
    const monthsAhead = Math.max(0, monthsBetween(now, projected));
    const projectedQty = hasAccumulation ? currentQty.add(accRate.mul(monthsAhead)) : currentQty;

    // Per-share stays at last year's actual run-rate (no growth applied for the
    // rest-of-year window). Scale by the projected qty; fall back to the raw
    // amount when no historical position is known.
    const perShare = histQty.lte(0)
      ? new Decimal(e.price).div(projectedQty)
      : new Decimal(e.price).div(histQty);
    const amount = perShare.mul(projectedQty);

    out.push({
      instrumentId: e.instrumentId,
      symbol: e.symbol ?? null,
      name: e.name ?? null,
      date: dateStr,
      amount: amount.toString(),
      currency: e.currency,
      basisYear: e.executedAt.getUTCFullYear(),
      source: "flat",
      assumesContributions: hasAccumulation ? true : undefined,
      perShare: perShare.toString(),
      quantity: projectedQty.toString(),
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Next-year cadence-based dividend projection engine
// ---------------------------------------------------------------------------

/**
 * Project equity dividends for the full next calendar year using cadence detection,
 * optional YoY per-share growth, and optional share-accumulation from regular buys.
 *
 * This engine replaces the TTM scalar approach for `forecastNextYear`:
 *
 * - **Cadence**: infers each instrument's payment frequency (monthly / quarterly /
 *   semiannual / annual) from the spacing of its last 24 months of payments, then
 *   generates the correct number of future payment dates within
 *   `(Dec 31 this year, Dec 31 next year]`.
 *
 * - **YoY growth** (`applyGrowth`, default `true`): computes a per-share growth
 *   multiplier = lastYear / yearBefore per-share annual totals, clamped to [0.5, 2.0].
 *   One-off guard: payments exceeding 2× the instrument's median per-payment amount
 *   are excluded from the ratio (avoids special dividends inflating the growth rate).
 *   Requires ≥ 2 calendar years of data; defaults to 1.0 otherwise.
 *   Only applied to the *next*-year window — rest-of-year stays at current run-rate.
 *
 * - **Accumulation** (`accumulation`): optional map of instrument → shares-per-month
 *   rate (from recent savings-plan / buy transactions). Projected qty at a future date
 *   = currentQty + rate × monthsAhead. Flagged with `assumesContributions: true`.
 *
 * Each emitted `ProjectedDividend` carries `source: "flat" | "grown"` and optional
 * `growthApplied` / `assumesContributions` fields for UI display.
 *
 * Announced/paid data from `dividend_events` is blended at the API layer (same
 * pattern as `projectDividends`), not here.
 *
 * Only instruments still held (`heldQty` with qty > 0) are projected. Instruments
 * with no payment in the trailing 24 months are skipped.
 *
 * Payments are bucketed to one-per-instrument-per-calendar-month (see `bucketMonthly`)
 * before any per-share/cadence/growth math, so a multi-leg correction month counts as
 * one payment rather than N diluted fragments.
 */
export function projectNextYearDividends(
  pastDividends: IncomeEntry[],
  heldQty: Map<string, string>,
  qtyAt: (instrumentId: string, at: Date) => string,
  now: Date = new Date(),
  opts: {
    /** Per-instrument monthly share accumulation rate (shares/month). */
    accumulation?: Map<string, string>;
    /** Apply YoY per-share growth factor. Default: true. */
    applyGrowth?: boolean;
  } = {},
): ProjectedDividend[] {
  const applyGrowth = opts.applyGrowth ?? true;
  const currentYear = now.getUTCFullYear();
  const nextYear = currentYear + 1;
  // Window: (Dec 31 thisYear, Dec 31 nextYear], exclusive/inclusive.
  const windowStart = new Date(Date.UTC(currentYear, 11, 31, 23, 59, 59, 999));
  const windowEnd = new Date(Date.UTC(nextYear, 11, 31, 23, 59, 59, 999));

  // Group past dividend payments by instrument. Bucketed to one payment per calendar
  // month first (see `bucketMonthly`) so a multi-leg correction month (e.g. a US-REIT
  // 1099-DIV recharacterization) counts as one payment, not N diluted fragments.
  const byInstrument = new Map<string, IncomeEntry[]>();
  for (const e of bucketMonthly(pastDividends)) {
    if (e.type !== "dividend" || !e.instrumentId) continue;
    const list = byInstrument.get(e.instrumentId) ?? [];
    list.push(e);
    byInstrument.set(e.instrumentId, list);
  }

  const out: ProjectedDividend[] = [];

  // Cut-off: require at least one payment within the trailing 24 months.
  // Using 24 months (not 12) captures annual payers whose payment may be
  // 12–24 months back (e.g., a March annual payer when now is June).
  const cutoff24mo = addUTCMonths(now, -24);
  // Trailing 12-month boundary — used to anchor the per-share run-rate base.
  const cutoff12mo = addUTCMonths(now, -12);

  for (const [instrumentId, entries] of byInstrument) {
    const currentQtyStr = heldQty.get(instrumentId);
    if (!currentQtyStr || new Decimal(currentQtyStr).lte(0)) continue;
    const currentQty = new Decimal(currentQtyStr);

    // Sort ascending.
    const sorted = [...entries].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());

    // Skip instruments with no recent activity.
    const hasRecent = sorted.some((e) => e.executedAt >= cutoff24mo);
    if (!hasRecent) continue;

    // Compute per-share for each historical payment where the position is known.
    // Payments where qtyAt returns ≤ 0 are excluded entirely — using the raw total
    // amount as a "per-share" figure (the old fallback) manufactures an enormous
    // outlier that skews both the base and the growth factor, particularly for
    // instruments with a missing transfer-in (e.g. a DKB Kapitalmaßnahme that
    // isn't in the CSV export).
    const perShareAmounts: { date: Date; year: number; perShare: Decimal }[] = [];
    for (const e of sorted) {
      const histQtyStr = qtyAt(instrumentId, e.executedAt);
      const histQty = new Decimal(histQtyStr);
      if (histQty.lte(0)) continue; // no recorded position at this date — skip
      perShareAmounts.push({
        date: e.executedAt,
        year: e.executedAt.getUTCFullYear(),
        perShare: new Decimal(e.price).div(histQty),
      });
    }

    // Per-share base: mean of payments in the trailing 12 months (current run-rate).
    //
    // Anchoring to the trailing-12mo mean (not the 24-month midpoint) ensures the
    // projected per-share reconciles with both the displayed run-rate and the YoY
    // growth badge. Using the 24-month average as the base and then multiplying by
    // (trailing/prior) double-counts the trailing window and produces a value that
    // neither matches the current actual nor the badge percentage.
    //
    // Fallback chain (for annual payers or data gaps):
    //   1. Trailing-12mo mean (preferred — most recent run-rate)
    //   2. Most-recent valid payment's per-share (if trailing window is empty,
    //      e.g. an annual payer whose last payment was 12–24 months ago)
    //   3. Skip the instrument (no valid qty > 0 payments in the 24-month window)
    const trailing12moAmounts = perShareAmounts.filter((p) => p.date > cutoff12mo);
    let perSharePerPayment: Decimal;
    if (trailing12moAmounts.length > 0) {
      perSharePerPayment = trailing12moAmounts
        .reduce((s, p) => s.add(p.perShare), new Decimal(0))
        .div(trailing12moAmounts.length);
    } else if (perShareAmounts.length > 0) {
      // Annual payer whose last payment is 12–24 months back — use the most recent.
      perSharePerPayment = perShareAmounts[perShareAmounts.length - 1].perShare;
    } else {
      // No valid (qty > 0) payments in the history — cannot compute a base; skip.
      continue;
    }

    // Infer cadence from recent dates (trailing 24 months).
    const recentDates = sorted.filter((e) => e.executedAt >= cutoff24mo).map((e) => e.executedAt);
    const intervalMonths = inferIntervalMonths(recentDates);

    // Growth factor for the next-year window.
    const growthFactor = applyGrowth ? computeGrowthFactor(perShareAmounts, now) : 1.0;
    const growthApplied = Math.abs(growthFactor - 1.0) > 0.001 ? growthFactor : undefined;
    const source: "flat" | "grown" = growthApplied !== undefined ? "grown" : "flat";

    // Accumulation rate (shares/month) for this instrument.
    const accRate = opts.accumulation
      ? new Decimal(opts.accumulation.get(instrumentId) ?? "0")
      : new Decimal(0);
    const hasAccumulation = accRate.gt(0);

    // Generate future payment dates from the most recent payment anchor.
    const lastPayment = sorted[sorted.length - 1].executedAt;
    let d = addUTCMonths(lastPayment, intervalMonths);
    // Step forward until we enter the target window.
    while (d <= windowStart) {
      d = addUTCMonths(d, intervalMonths);
    }
    // Emit one entry per generated date within the window.
    while (d <= windowEnd) {
      const monthsAhead = Math.max(0, monthsBetween(now, d));
      const projectedQty = hasAccumulation ? currentQty.add(accRate.mul(monthsAhead)) : currentQty;
      const perShareFinal = perSharePerPayment.mul(growthFactor);
      const amount = perShareFinal.mul(projectedQty);

      out.push({
        instrumentId,
        symbol: entries[0].symbol ?? null,
        name: entries[0].name ?? null,
        date: toDateKey(d),
        amount: amount.toString(),
        currency: entries[0].currency,
        basisYear: currentYear,
        source,
        growthApplied,
        assumesContributions: hasAccumulation ? true : undefined,
        perShare: perShareFinal.toString(),
        quantity: projectedQty.toString(),
      });

      d = addUTCMonths(d, intervalMonths);
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

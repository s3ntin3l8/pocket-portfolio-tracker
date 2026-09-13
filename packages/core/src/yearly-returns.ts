/**
 * Per-calendar-year portfolio & benchmark returns.
 *
 * Given a chained TWR index for the portfolio and one or more chained TWR indices
 * for reference benchmarks, emit one row per calendar year present in the union
 * of all series. Portfolio TWR is anchored to the prior year's close when one
 * exists (falling back to the year's first point for the inception year), so a
 * year doesn't silently omit the Dec 31 → first-trading-day move; benchmark TWR
 * is computed from the same endpoints after FX-converting the year-start and
 * year-end levels to the display currency (only 2 fx calls per benchmark per
 * year — ratio-based, so intermediate FX isn't needed).
 *
 * Portfolio XIRR pairs the year's boundary flows with an OPENING NAV outflow
 * (the prior year's closing NAV, if any) and a closing NAV inflow — omitting
 * the opening NAV would treat capital already at work before the year began as
 * if it appeared for free, inflating the rate (see `computeYearlyXirr`).
 *
 * Year-slicing is done by YYYY prefix on the ISO date key — no Date math, no TZ
 * ambiguity. The current calendar year (per `asOf.getUTCFullYear()`) is flagged
 * so the UI can label it "YTD".
 */
import { D } from "./decimal.js";
import type { IndexPoint } from "./twr.js";
import type { CashFlowPoint } from "./xirr.js";
import { xirr } from "./xirr.js";

export interface YearlyReturnBenchmarkInput {
  symbol: string;
  displayName: string;
  nativeCurrency: string;
  /** Chained TWR index for this benchmark, in `nativeCurrency`. */
  index: IndexPoint[];
}

export interface YearlyReturnBenchmarkOutput {
  symbol: string;
  displayName: string;
  nativeCurrency: string;
  twr: string | null;
  activeReturn: string | null;
}

export interface YearlyReturnRow {
  year: number;
  isCurrentYear: boolean;
  /** Decimal fraction (0.1 = +10%). null if the portfolio has no data in this year. */
  portfolioTwr: string | null;
  /** Decimal fraction. null if XIRR can't be computed (e.g. no flows or no NAV). */
  portfolioXirr: string | null;
  benchmarks: YearlyReturnBenchmarkOutput[];
}

export interface YearlyPortfolioFlow {
  /** Boundary cash flow (in display currency) on the given date. */
  amount: string;
  date: Date;
}

export interface ComputeYearlyReturnsInput {
  pfIndex: IndexPoint[];
  /**
   * Per-year boundary cash flows (in display currency) for XIRR. To compute a
   * per-year XIRR, the helper pairs each year's flows with the year's terminal
   * NAV (synthetic inflow) read from `pfEndNavByYear`, and — when the portfolio
   * already existed the previous year — an opening-NAV outflow read from the
   * PRIOR year's entry in the same map (see `computeYearlyXirr`).
   */
  pfFlowsByYear: Map<number, YearlyPortfolioFlow[]>;
  /**
   * Per-year terminal NAV (in display currency), keyed by calendar year. The
   * terminal NAV is paired with `pfFlowsByYear` to seed XIRR. Typically
   * `sum(holdingsMarketValue) + cash - liabilities` on the last snapshot of the
   * year. A year's OPENING NAV is read from this same map at `year - 1` — a
   * portfolio's capital already at work on Jan 1 is not itself a flow, but
   * omitting it from the XIRR cash-flow vector understates the invested base
   * and manufactures an inflated rate (see the module-level rationale).
   */
  pfEndNavByYear: Map<number, string>;
  benchmarks: YearlyReturnBenchmarkInput[];
  /** The "as of" date — drives `isCurrentYear`. */
  asOf: Date;
}

export function computeYearlyReturns(input: ComputeYearlyReturnsInput): YearlyReturnRow[] {
  const { pfIndex, pfFlowsByYear, pfEndNavByYear, benchmarks, asOf } = input;

  const years = collectYears(pfIndex, benchmarks);
  if (years.length === 0) return [];

  const currentYear = asOf.getUTCFullYear();
  const rows: YearlyReturnRow[] = [];

  for (const year of years) {
    const pfSlice = sliceByYear(pfIndex, year);
    // Anchor to the LAST index point before this year (its close) rather than the
    // first point WITHIN the year — the latter silently omits the Dec 31 → first-
    // trading-day move for every year after the first. Falls back to the in-year
    // first point for the inception year, when no prior close exists.
    const priorClose = priorYearClose(pfIndex, year);
    let portfolioTwr: string | null = null;
    if (pfSlice.length > 0 && (priorClose !== null || pfSlice.length >= 2)) {
      const startPoint = priorClose ?? pfSlice[0];
      portfolioTwr = yearReturn(startPoint, pfSlice[pfSlice.length - 1]);
    }

    const portfolioXirr = computeYearlyXirr(
      pfFlowsByYear.get(year) ?? [],
      pfEndNavByYear.get(year) ?? null,
      pfEndNavByYear.get(year - 1) ?? null,
      pfSlice,
      year,
    );

    const benchmarkOutputs: YearlyReturnBenchmarkOutput[] = benchmarks.map((bm) => {
      const bmSlice = sliceByYear(bm.index, year);
      const twr = bmSlice.length >= 2 ? yearReturn(bmSlice[0], bmSlice[bmSlice.length - 1]) : null;
      const activeReturn =
        portfolioTwr !== null && twr !== null ? D(portfolioTwr).sub(D(twr)).toString() : null;
      return {
        symbol: bm.symbol,
        displayName: bm.displayName,
        nativeCurrency: bm.nativeCurrency,
        twr,
        activeReturn,
      };
    });

    rows.push({
      year,
      isCurrentYear: year === currentYear,
      portfolioTwr,
      portfolioXirr,
      benchmarks: benchmarkOutputs,
    });
  }

  return rows;
}

function collectYears(pfIndex: IndexPoint[], benchmarks: YearlyReturnBenchmarkInput[]): number[] {
  const set = new Set<number>();
  for (const p of pfIndex) set.add(Number(p.date.slice(0, 4)));
  for (const bm of benchmarks) for (const p of bm.index) set.add(Number(p.date.slice(0, 4)));
  return [...set].sort((a, b) => a - b);
}

function sliceByYear(index: IndexPoint[], year: number): IndexPoint[] {
  const prefix = String(year);
  return index.filter((p) => p.date.startsWith(prefix));
}

/**
 * The last index point strictly before the given calendar year — its "prior close" —
 * or null if the index has no data before that year (the inception year). `index` is
 * assumed sorted ascending; date strings are fixed-width ISO (YYYY-MM-DD), so a plain
 * lexicographic comparison against the year prefix is safe.
 */
function priorYearClose(index: IndexPoint[], year: number): IndexPoint | null {
  const prefix = String(year);
  let prior: IndexPoint | null = null;
  for (const p of index) {
    // A full "YYYY-MM-DD" date always compares greater than its own bare 4-digit
    // year prefix (it has trailing characters), so this also catches an exact
    // boundary date without a separate startsWith check.
    if (p.date > prefix) break;
    prior = p;
  }
  return prior;
}

/** TWR between two index points, as a decimal fraction (e.g. 0.10 = +10%). */
function yearReturn(first: IndexPoint, last: IndexPoint): string {
  return D(last.index).div(D(first.index)).sub(1).toString();
}

/**
 * Per-year money-weighted return. Seeds the cash-flow vector with:
 *   − opening NAV (an outflow, dated Jan 1) when the portfolio already had a
 *     nonzero balance at the prior year's close — without this, capital already
 *     at work before the year began is invisible to XIRR and inflates the rate
 *     (a portfolio worth €30k on Jan 1 that takes €2k of deposits and ends at
 *     €36k is a modest real return, not the >250% XIRR the missing opening NAV
 *     would imply);
 *   + this year's boundary flows, as recorded;
 *   + closing NAV (an inflow, dated at the last observed slice date) — matches
 *     the `periodXirr` convention and avoids collapsing onto the same date as
 *     the last flow.
 * A year with a zero opening NAV and no flows correctly yields null (xirr()
 * itself rejects a single-point, no-sign-change cash-flow vector) — there is
 * nothing to intentionally guard against here beyond that.
 */
function computeYearlyXirr(
  flows: YearlyPortfolioFlow[],
  endNav: string | null,
  startNav: string | null,
  pfSlice: IndexPoint[],
  year: number,
): string | null {
  if (endNav === null || pfSlice.length === 0) return null;
  const nav = D(endNav);
  if (nav.lte(0)) return null;

  const all: CashFlowPoint[] = [];
  const opening = D(startNav ?? "0");
  if (opening.gt(0)) {
    all.push({ amount: opening.neg().toString(), date: new Date(`${year}-01-01T00:00:00Z`) });
  }
  all.push(...flows.map((f) => ({ amount: f.amount, date: f.date })));
  // Use the last observed slice date (typically year-end or asOf) as the
  // terminal inflow date — that matches the periodXirr convention and avoids
  // collapsing the inflow onto the same date as the last flow.
  const lastSliceDate = pfSlice[pfSlice.length - 1].date;
  const terminalDate = new Date(`${lastSliceDate}T00:00:00Z`);
  all.push({ amount: nav.toString(), date: terminalDate });

  const rate = xirr(all);
  if (!Number.isFinite(rate) || Math.abs(rate) > 50) return null;
  return String(rate);
}

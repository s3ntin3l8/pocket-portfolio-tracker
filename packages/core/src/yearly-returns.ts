/**
 * Per-calendar-year portfolio & benchmark returns.
 *
 * Given a chained TWR index for the portfolio and one or more chained TWR indices
 * for reference benchmarks, emit one row per calendar year present in the union
 * of all series. Portfolio TWR is computed from the chained-index endpoints for
 * that year; benchmark TWR is computed from the same endpoints after FX-converting
 * the year-start and year-end levels to the display currency (only 2 fx calls per
 * benchmark per year — ratio-based, so intermediate FX isn't needed).
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
   * NAV (synthetic inflow) read from `pfEndNavByYear`.
   */
  pfFlowsByYear: Map<number, YearlyPortfolioFlow[]>;
  /**
   * Per-year terminal NAV (in display currency), keyed by calendar year. The
   * terminal NAV is paired with `pfFlowsByYear` to seed XIRR. Typically
   * `sum(holdingsMarketValue) + cash - liabilities` on the last snapshot of the
   * year.
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
    const portfolioTwr =
      pfSlice.length >= 2 ? yearReturn(pfSlice[0], pfSlice[pfSlice.length - 1]) : null;

    const portfolioXirr = computeYearlyXirr(
      pfFlowsByYear.get(year) ?? [],
      pfEndNavByYear.get(year) ?? null,
      pfSlice,
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

/** TWR between two index points, as a decimal fraction (e.g. 0.10 = +10%). */
function yearReturn(first: IndexPoint, last: IndexPoint): string {
  return D(last.index).div(D(first.index)).sub(1).toString();
}

function computeYearlyXirr(
  flows: YearlyPortfolioFlow[],
  endNav: string | null,
  pfSlice: IndexPoint[],
): string | null {
  if (flows.length === 0 || endNav === null || pfSlice.length === 0) return null;
  const nav = D(endNav);
  if (nav.lte(0)) return null;
  // Use the last observed slice date (typically year-end or asOf) as the
  // terminal inflow date — that matches the periodXirr convention and avoids
  // collapsing the inflow onto the same date as the last flow.
  const lastSliceDate = pfSlice[pfSlice.length - 1].date;
  const terminalDate = new Date(`${lastSliceDate}T00:00:00Z`);
  const all: CashFlowPoint[] = [
    ...flows.map((f) => ({ amount: f.amount, date: f.date })),
    { amount: nav.toString(), date: terminalDate },
  ];
  const rate = xirr(all);
  if (!Number.isFinite(rate) || Math.abs(rate) > 50) return null;
  return String(rate);
}

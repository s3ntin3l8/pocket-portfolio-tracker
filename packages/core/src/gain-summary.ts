import { Decimal } from "decimal.js";
import type { PortfolioSummary } from "./valuation.js";

/**
 * Which investment boundary the figures in a {@link GainSummary} sit on (CLAUDE.md "one
 * boundary per portfolio"). `"mixed"` = an aggregate over portfolios that declare
 * different boundaries — `value` and `netContributed` are still each the per-portfolio
 * same-boundary pairs, summed.
 */
export type GainBoundary = "inside" | "outside" | "mixed";

/**
 * The one gain story: every gain figure the UI shows is a pairing of fields from this
 * shape, so each can carry an explicit basis label instead of being an unlabelled number.
 * All amounts are Decimal strings in `displayCurrency`.
 *
 * - `value` — what the scope is worth now (`summarizePortfolio().netWorth`; cash is in it
 *   only for cash-inside portfolios).
 * - `costOfOpen` — cost basis of the holdings still open (the "vs cost of holdings" basis).
 * - `netContributed` — net external capital that crossed the boundary (the "vs net
 *   contributed" basis; deposits − withdrawals inside, net invested capital outside).
 * - `unrealized` — market value of open holdings minus `costOfOpen` (a holding valued at
 *   cost contributes 0).
 * - `realized` — gains already locked in by sells.
 * - `income` — dividends, coupons and interest received (return, never contribution).
 */
export interface GainSummary {
  displayCurrency: string;
  boundary: GainBoundary;
  value: string;
  costOfOpen: string;
  netContributed: string;
  unrealized: string;
  realized: string;
  income: string;
}

/**
 * Derive the {@link GainSummary} from an already-computed valuation and the portfolio's
 * contribution stats. Deliberately introduces no new walk or boundary logic: every field
 * is a field of `summarizePortfolio` or `contributionStats`/`mergeContributionStats`
 * (computed for the same instruments — the caller passes the fxMissing-excluded stats).
 */
export function gainSummary(args: {
  summary: Pick<
    PortfolioSummary,
    | "displayCurrency"
    | "netWorth"
    | "totalCost"
    | "totalUnrealizedPnL"
    | "totalRealizedPnL"
    | "totalIncome"
  >;
  contribution: { netContributed: string };
  boundary: GainBoundary;
}): GainSummary {
  const { summary, contribution, boundary } = args;
  const d = (v: string) => new Decimal(v).toString();
  return {
    displayCurrency: summary.displayCurrency,
    boundary,
    value: d(summary.netWorth),
    costOfOpen: d(summary.totalCost),
    netContributed: d(contribution.netContributed),
    unrealized: d(summary.totalUnrealizedPnL),
    realized: d(summary.totalRealizedPnL),
    income: d(summary.totalIncome),
  };
}

/** The boundary of an aggregate: the shared one if all portfolios agree, else `"mixed"`. */
export function aggregateBoundary(boundaries: ("inside" | "outside")[]): GainBoundary {
  if (boundaries.length === 0) return "outside";
  const first = boundaries[0]!;
  return boundaries.every((b) => b === first) ? first : "mixed";
}

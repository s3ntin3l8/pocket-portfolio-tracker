import { ZERO } from "../decimal.js";
import type { CashFlowPoint } from "../xirr.js";
import { MS_PER_DAY } from "../date-utils.js";
import type { Episode } from "./types.js";

/** Default §23-EStG-style threshold: gold/other private-sale gains are tax-free after a 1-year hold. */
export const LONG_TERM_DAYS = 365;
/** Quantity residual below which a position counts as fully closed (import rounding dust). */
export const DEFAULT_DUST = "0.000001";

export function calcAvgHoldingDays(flows: CashFlowPoint[], holdingDays: number): number {
  if (flows.length < 2) return holdingDays;
  const MS_PER_YEAR = MS_PER_DAY * 365;
  const t0 = Math.min(...flows.map((f) => f.date.getTime()));
  const outflows = flows.filter((f) => Number(f.amount) < 0);
  const inflows = flows.filter((f) => Number(f.amount) > 0);
  const wavg = (side: typeof flows) => {
    const totalAmt = side.reduce((s, f) => s + Math.abs(Number(f.amount)), 0);
    if (totalAmt === 0) return 0;
    return (
      side.reduce(
        (s, f) => s + Math.abs(Number(f.amount)) * ((f.date.getTime() - t0) / MS_PER_YEAR),
        0,
      ) / totalAmt
    );
  };
  const avgHoldingYears = wavg(inflows) - wavg(outflows);
  if (avgHoldingYears > 0) {
    return Math.round(avgHoldingYears * 365);
  }
  return holdingDays;
}

export function makeEpisode(at: Date): Episode {
  return {
    entryDate: at,
    acqQtyPrice: ZERO,
    acqQty: ZERO,
    acqCost: ZERO,
    sellQtyPrice: ZERO,
    soldQty: ZERO,
    realized: ZERO,
    legs: [],
    vorabByYear: new Map(),
    flows: [],
  };
}

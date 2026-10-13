import { ZERO } from "../decimal.js";
import type { CashFlowPoint } from "../xirr.js";
import { MS_PER_DAY } from "../date-utils.js";
import type { Episode } from "./types.js";

/**
 * §23 EStG private-sale test: gains are tax-free only if the asset was held MORE than one
 * year. Calendar arithmetic (not a 365-day count, which is wrong across leap years): the
 * period runs from acquisition to the same calendar day a year later (a Feb 29
 * acquisition ends on Feb 28; §188 Abs. 2 BGB), and a sale ON that anniversary is still
 * within the year — only a later day counts. Compared on UTC dates.
 */
export function heldMoreThanOneYear(acq: Date, sell: Date): boolean {
  const y = acq.getUTCFullYear() + 1;
  const m = acq.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const anniversary = Date.UTC(y, m, Math.min(acq.getUTCDate(), lastDay));
  const sellDay = Date.UTC(sell.getUTCFullYear(), sell.getUTCMonth(), sell.getUTCDate());
  return sellDay > anniversary;
}

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

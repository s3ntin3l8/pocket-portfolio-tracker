import { Decimal } from "decimal.js";
import { xirr, type CashFlowPoint } from "./xirr.js";
import { XIRR_MAX_RATE } from "./sanity-gates.js";

/**
 * Compute period-scoped XIRR. Treats the portfolio value at `anchorDate` (the date of
 * the first snapshot at or after the nominal period start) as an initial "cost" and
 * computes XIRR from that anchor to now.
 *
 * The caller must pass the **actual snapshot date** as `anchorDate`, not the nominal
 * period start (e.g., Jan 1 for YTD). This prevents double-counting flows that are
 * already embedded in the snapshot value but would otherwise fall between the nominal
 * period start and the snapshot date.
 *
 * @param allFlows    All boundary cash-flow points (before the terminal inflow).
 * @param currentValue  The current total net worth (used as the terminal inflow).
 * @param startNav    The portfolio's NAV at `anchorDate` — becomes the synthetic opening outflow.
 * @param anchorDate  The actual snapshot date used as the opening anchor.
 * @param asOf        The "as of" date for the terminal inflow (usually now).
 * @returns Annualised XIRR as a decimal (e.g. 0.12 = 12%), or null if undetermined.
 */
export function periodXirr(
  allFlows: CashFlowPoint[],
  currentValue: number,
  startNav: number,
  anchorDate: Date,
  asOf: Date,
): number | null {
  if (startNav <= 0) return null;

  // Filter to flows strictly after anchorDate — the opening NAV already embeds everything up to and
  // including that date, so re-adding those flows would double-count them.
  const postFlows = allFlows.filter((f) => f.date > anchorDate);

  // Synthetic outflow at anchorDate (the "cost" of holding at that date).
  const flows: CashFlowPoint[] = [
    { amount: -startNav, date: anchorDate },
    ...postFlows,
    { amount: currentValue, date: asOf },
  ];

  const rate = xirr(flows);
  // xirr() already caps at XIRR_MAX_RATE, but keep this guard here as a
  // belt-and-suspenders check that documents the period-XIRR-specific intent:
  // a period shorter than a year with extreme value movement produces an
  // annualized rate that's numerically correct but never meaningful to a user.
  if (!Number.isFinite(rate) || Math.abs(rate) > XIRR_MAX_RATE) return null;
  return rate;
}

/** Period selector shared by `/networth` (and anything else scoping a return to a window). */
export type ReturnPeriod = "ytd" | "1y" | "5y" | "max";

/**
 * Nominal start of a return period as a UTC midnight, or null for `max` (all history).
 * Built from `today`'s UTC calendar fields with `Date.UTC` — snapshot dates are UTC day
 * keys, so a local-time `new Date(y, 0, 1)` on a server east of UTC turned the YTD anchor
 * into Dec 31 of the prior year (audit D9). A Feb 29 `today` rolls to Mar 1 for `1y`/`5y`
 * (`Date.UTC` normalises the day overflow), same as the previous local-time code did.
 */
export function periodStartFor(period: ReturnPeriod, today: Date): Date | null {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const d = today.getUTCDate();
  if (period === "ytd") return new Date(Date.UTC(y, 0, 1));
  if (period === "1y") return new Date(Date.UTC(y - 1, m, d));
  if (period === "5y") return new Date(Date.UTC(y - 5, m, d));
  return null;
}

/** One portfolio's opening point for a period return. */
export interface PeriodAnchor {
  /** Net worth at the end of `snapshotDate`, already in the display currency (decimal string). */
  startNav: string;
  /** The snapshot's UTC day key (YYYY-MM-DD) — the earliest snapshot at/after the period start. */
  snapshotDate: string;
  /**
   * This portfolio's boundary flows in XIRR convention (negative = capital entering the
   * boundary, positive = leaving it), under its OWN boundary — same list the all-time XIRR
   * uses. Only those after the end of `snapshotDate` are counted; earlier ones are already
   * embedded in `startNav`.
   */
  flows: CashFlowPoint[];
}

export interface PeriodReturn {
  /** Gain over the period net of external flows, display currency (decimal string). */
  pnl: string;
  /** `pnl` over the Modified-Dietz average capital (null when that is ≤ 0). */
  pnlPct: number | null;
  /** Money-weighted annualised return over the period (null when undetermined). */
  xirr: number | null;
}

/** A snapshot dated D is the value at the END of day D (backfill values at 23:59:59.999Z). */
function endOfDay(dateKey: string): Date {
  return new Date(`${dateKey}T23:59:59.999Z`);
}

/**
 * Period P&L / return over several portfolios, each anchored at its OWN earliest snapshot
 * in the period (audit B10). Previously `/networth` reported `current − startNav` — a
 * deposit inside the period showed up as profit — and anchored the flow filter on the
 * latest snapshot date across portfolios, silently dropping one portfolio's flows that
 * fell between its own snapshot and another's.
 *
 *   pnl = current − Σ startNav + Σ flows after each anchor
 *
 * (flows are XIRR-signed: a deposit is negative, so it is subtracted; a dividend or sale
 * leaving an outside boundary is positive and counts as return). Same boundary as the
 * value on both sides, per portfolio. Money math in Decimal; only the XIRR solver takes
 * numbers.
 */
export function periodReturn(
  anchors: PeriodAnchor[],
  currentValue: string,
  asOf: Date,
): PeriodReturn {
  let startTotal = new Decimal(0);
  let netFlows = new Decimal(0);
  let weightedContrib = new Decimal(0);
  const xirrFlows: CashFlowPoint[] = [];
  const asOfMs = asOf.getTime();
  for (const a of anchors) {
    const start = endOfDay(a.snapshotDate);
    const startNav = new Decimal(a.startNav);
    startTotal = startTotal.add(startNav);
    xirrFlows.push({ amount: startNav.neg().toNumber(), date: start });
    const span = asOfMs - start.getTime();
    for (const f of a.flows) {
      if (f.date.getTime() <= start.getTime() || f.date.getTime() > asOfMs) continue;
      const amt = new Decimal(f.amount);
      netFlows = netFlows.add(amt);
      xirrFlows.push(f);
      // Modified Dietz: capital entering (negative flow) counts for the share of the
      // period it was invested; capital leaving reduces the base the same way.
      const weight = span > 0 ? new Decimal(asOfMs - f.date.getTime()).div(span) : new Decimal(0);
      weightedContrib = weightedContrib.add(amt.neg().mul(weight));
    }
  }
  const current = new Decimal(currentValue);
  const pnl = current.sub(startTotal).add(netFlows);
  const base = startTotal.add(weightedContrib);
  const pnlPct = base.gt(0) ? pnl.div(base).toNumber() : null;

  let rate: number | null = null;
  if (startTotal.gt(0)) {
    const r = xirr([...xirrFlows, { amount: current.toNumber(), date: asOf }]);
    rate = Number.isFinite(r) && Math.abs(r) <= XIRR_MAX_RATE ? r : null;
  }
  return { pnl: pnl.toString(), pnlPct, xirr: rate };
}

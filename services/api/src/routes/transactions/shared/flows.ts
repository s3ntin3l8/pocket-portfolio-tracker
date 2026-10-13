import type { FastifyInstance } from "fastify";
import {
  isAcquisitionType,
  isTransferType,
  type CoreTransaction,
  type CorporateAction,
  type CashFlowPoint,
  convert,
  cashFlow,
  boundaryFlowPoints,
  transferFlowPoints,
  partitionConvertible,
} from "@portfolio/core";
import { getFxRates, makeFxRateFn } from "../../../services/fx.js";

/**
 * Dated, signed cash flows crossing a portfolio's investment boundary, in XIRR
 * convention (negative = contribution, positive = withdrawal/return of capital).
 *
 * Inside boundary: a thin FX-lookup adapter over `@portfolio/core`'s
 * `boundaryFlowPoints` — deposit/withdrawal/transfer_in/transfer_out are the only
 * rows that ever cross an inside boundary, and cost-basis valuation and cash-received
 * valuation coincide for all four, so the core walk is the complete, correct flow list
 * here. It used to only include deposit/withdrawal, silently dropping transfers
 * (issue #736).
 *
 * Outside boundary: cash-received valuation (`cashFlow()`) for every row EXCEPT
 * transfers — sells at proceeds, dividends/coupons included as income, matching
 * `enrichContributions`'s `totalReturnPct` and XIRR's expectation of real cash-flow
 * timing/magnitude. Transfer rows are drawn from `@portfolio/core`'s
 * `transferFlowPoints` instead, valued at carried/average cost — `cashFlow()` values
 * them at ≈0 (a transfer moves shares, not cash), which is issue #736. These two
 * valuations are NOT interchangeable: `contributionStats`' own outside-boundary walk
 * values a sell at cost-of-sold (capital still deployed) rather than proceeds, and
 * doesn't touch dividends at all (return, never contribution — CLAUDE.md) — collapsing
 * this file to delegate wholesale to that walk would silently drop realized gains and
 * dividend income from XIRR/`totalReturnPct`. Only the transfer valuation is shared;
 * see `boundaryFlowPoints`'s doc comment in `@portfolio/core` for the full rationale.
 */
/**
 * Drop every row of the instruments the value side couldn't value for lack of an FX rate
 * (`summary.holdings[].fxMissing` — quote OR cost currency unrated; audit B2), so a
 * contribution/XIRR flow list and the net worth it is paired with exclude the SAME
 * instruments. `partitionConvertible` on transaction currencies alone is not enough:
 * a stock bought in EUR but quoted in an unrated USD keeps its EUR buy convertible
 * while `summarizePortfolio` drops the holding — the buy would stay in the contribution
 * with no value against it (a phantom near-total loss).
 */
export function excludeFxMissingInstruments<T extends { instrumentId?: string | null }>(
  txns: T[],
  summary: { holdings: { instrumentId: string; fxMissing?: boolean }[] },
): T[] {
  const missing = new Set(summary.holdings.filter((h) => h.fxMissing).map((h) => h.instrumentId));
  if (missing.size === 0) return txns;
  return txns.filter((t) => !t.instrumentId || !missing.has(t.instrumentId));
}

/**
 * A boundary flow point tagged with the source row's `kind`, so a consumer can tell the
 * legs of an internal swap (a `merger` sell/buy pair, a dividend `reinvestment` buy) from
 * external capital — see `enrichContributions`' `totalReturnPct` (audit B8). XIRR ignores
 * the extra field; transfer points carry no kind.
 */
export interface KindedCashFlowPoint extends CashFlowPoint {
  kind?: string | null;
}

export async function boundaryFlows(
  app: FastifyInstance,
  allTxns: CoreTransaction[],
  boundary: "inside" | "outside",
  target: string,
  /** Split/bonus actions for the pool replay behind transfer valuation (audit B9) —
   *  pass the valuation's `corporateActions`. */
  corporateActions: CorporateAction[] = [],
): Promise<KindedCashFlowPoint[]> {
  const rates = await getFxRates(app.db, [...new Set(allTxns.map((t) => t.currency))], target);
  const fx = makeFxRateFn(rates, target);
  // Exclude rows with no FX rate (audit B2) — reported as fxMissingCurrencies; the
  // matching value (summary net worth) excludes the same currencies.
  const txns = partitionConvertible(allTxns, target, fx).convertible;

  if (boundary === "inside") {
    return boundaryFlowPoints(txns, "inside", target, fx, corporateActions);
  }

  const isLegacyTransferBonus = (t: CoreTransaction): boolean =>
    t.type === "bonus" && t.kind === "transfer_in";
  const isInvestmentFlow = (t: CoreTransaction): boolean => {
    if (isTransferType(t.type) || isLegacyTransferBonus(t)) return false; // valued below
    if (t.type === "sell" || t.type === "dividend" || t.type === "coupon") return true;
    if (isAcquisitionType(t.type)) return t.kind !== "saveback";
    return false;
  };
  const cashValued: KindedCashFlowPoint[] = txns.filter(isInvestmentFlow).map((t) => ({
    amount: Number(convert(cashFlow(t).toString(), t.currency, target, fx)),
    date: t.executedAt,
    kind: t.kind ?? null,
  }));
  const transferValued = transferFlowPoints(txns, "outside", target, fx, corporateActions);
  return [...cashValued, ...transferValued].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Convenience alias for the inside boundary (deposit/withdrawal + carried-cost transfers). */
export async function externalFlows(
  app: FastifyInstance,
  txns: CoreTransaction[],
  target: string,
  corporateActions: CorporateAction[] = [],
): Promise<CashFlowPoint[]> {
  return boundaryFlows(app, txns, "inside", target, corporateActions);
}

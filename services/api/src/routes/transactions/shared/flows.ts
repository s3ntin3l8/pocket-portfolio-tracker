import type { FastifyInstance } from "fastify";
import {
  isAcquisitionType,
  isTransferType,
  type CoreTransaction,
  type CashFlowPoint,
  convert,
  cashFlow,
  boundaryFlowPoints,
  transferFlowPoints,
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
export async function boundaryFlows(
  app: FastifyInstance,
  txns: CoreTransaction[],
  boundary: "inside" | "outside",
  target: string,
): Promise<CashFlowPoint[]> {
  const rates = await getFxRates(app.db, [...new Set(txns.map((t) => t.currency))], target);
  const fx = makeFxRateFn(rates, target);

  if (boundary === "inside") {
    return boundaryFlowPoints(txns, "inside", target, fx);
  }

  const isLegacyTransferBonus = (t: CoreTransaction): boolean =>
    t.type === "bonus" && t.kind === "transfer_in";
  const isInvestmentFlow = (t: CoreTransaction): boolean => {
    if (isTransferType(t.type) || isLegacyTransferBonus(t)) return false; // valued below
    if (t.type === "sell" || t.type === "dividend" || t.type === "coupon") return true;
    if (isAcquisitionType(t.type)) return t.kind !== "saveback";
    return false;
  };
  const cashValued = txns.filter(isInvestmentFlow).map((t) => ({
    amount: Number(convert(cashFlow(t).toString(), t.currency, target, fx)),
    date: t.executedAt,
  }));
  const transferValued = transferFlowPoints(txns, "outside", target, fx);
  return [...cashValued, ...transferValued].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Convenience alias for the inside boundary (deposit/withdrawal + carried-cost transfers). */
export async function externalFlows(
  app: FastifyInstance,
  txns: CoreTransaction[],
  target: string,
): Promise<CashFlowPoint[]> {
  return boundaryFlows(app, txns, "inside", target);
}

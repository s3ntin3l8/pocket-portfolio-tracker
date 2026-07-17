import type { FastifyInstance } from "fastify";
import {
  isAcquisitionType,
  isTransferType,
  type CoreTransaction,
  type CashFlowPoint,
  convert,
  cashFlow,
} from "@portfolio/core";
import { getFxRates, makeFxRateFn } from "../../../services/fx.js";

export async function externalFlows(
  app: FastifyInstance,
  txns: CoreTransaction[],
  target: string,
): Promise<CashFlowPoint[]> {
  const relevant = txns.filter((t) => t.type === "deposit" || t.type === "withdrawal");
  const rates = await getFxRates(app.db, [...new Set(relevant.map((t) => t.currency))], target);
  const fx = makeFxRateFn(rates, target);
  return relevant.map((t) => ({
    amount: Number(convert(t.price, t.currency, target, fx)) * (t.type === "deposit" ? -1 : 1),
    date: t.executedAt,
  }));
}

export async function boundaryFlows(
  app: FastifyInstance,
  txns: CoreTransaction[],
  boundary: "inside" | "outside",
  target: string,
): Promise<CashFlowPoint[]> {
  if (boundary === "inside") return externalFlows(app, txns, target);
  const isInvestmentFlow = (t: CoreTransaction): boolean => {
    if (t.type === "sell" || t.type === "dividend" || t.type === "coupon") return true;
    if (isAcquisitionType(t.type)) return t.kind !== "saveback";
    if (isTransferType(t.type)) return true;
    if (t.type === "bonus") return t.kind === "transfer_in";
    return false;
  };
  const relevant = txns.filter(isInvestmentFlow);
  const rates = await getFxRates(app.db, [...new Set(relevant.map((t) => t.currency))], target);
  const fx = makeFxRateFn(rates, target);
  return relevant.map((t) => ({
    amount: Number(convert(cashFlow(t).toString(), t.currency, target, fx)),
    date: t.executedAt,
  }));
}

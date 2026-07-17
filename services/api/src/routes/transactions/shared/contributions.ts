import type { FastifyInstance } from "fastify";
import {
  contributionStats,
  detectSparplans,
  xirr,
  type CashFlowPoint,
  type ContributionStats,
  type CoreTransaction,
  type PortfolioSummary,
  type SparplanStats,
} from "@portfolio/core";
import { getFxRates, makeFxRateFn } from "../../../services/fx.js";
import { boundaryFlows } from "./flows.js";
import { instrumentMeta } from "./helpers.js";

export function enrichContributions(
  stats: ContributionStats,
  currentValue: string,
  flows: CashFlowPoint[],
  birthYear: number | null = null,
  portfolioType: "standard" | "child" = "standard",
  opts: { totalReturn?: boolean; retirementAge?: number | null } = {},
) {
  const net = Number(stats.netContributed);
  const simpleGainPct = net > 0 ? (Number(currentValue) - net) / net : null;

  const gross = Number(stats.totalContributed);
  const positiveFlows = flows.reduce((s, f) => {
    const amt = Number(f.amount);
    return amt > 0 ? s + amt : s;
  }, 0);
  const totalReturnPct =
    (opts.totalReturn ?? true) && gross > 0
      ? (Number(currentValue) + positiveFlows - gross) / gross
      : null;

  const asOf = new Date();
  const allFlows: CashFlowPoint[] = [...flows, { amount: Number(currentValue), date: asOf }];
  const rate = flows.length ? xirr(allFlows) : NaN;
  const xirrVal = Number.isFinite(rate) ? rate : null;
  const seedAnnualReturn =
    xirrVal !== null && xirrVal > -0.5 && xirrVal < 0.5 ? xirrVal.toString() : "0.07";

  return {
    ...stats,
    currentValue,
    simpleGainPct,
    totalReturnPct,
    xirr: xirrVal,
    seedAnnualReturn,
    birthYear,
    portfolioType,
    retirementAge: opts.retirementAge ?? null,
    asOf: asOf.toISOString(),
  };
}

export async function buildContributions(
  app: FastifyInstance,
  coreTxns: CoreTransaction[],
  summary: PortfolioSummary,
  display: string,
  birthYear: number | null = null,
  portfolioType: "standard" | "child" = "standard",
  boundary: "inside" | "outside" = "inside",
  retirementAge: number | null = null,
) {
  const ccys = [...new Set(coreTxns.map((t) => t.currency))];
  const rates = await getFxRates(app.db, ccys, display);
  const fx = makeFxRateFn(rates, display);
  const stats = contributionStats({
    txns: coreTxns,
    displayCurrency: display,
    fx,
    boundary,
  });
  const flows = await boundaryFlows(app, coreTxns, boundary, display);
  return enrichContributions(stats, summary.netWorth, flows, birthYear, portfolioType, {
    totalReturn: boundary === "outside",
    retirementAge,
  });
}

export async function buildSparplanStats(
  app: FastifyInstance,
  coreTxns: CoreTransaction[],
  display: string,
): Promise<
  SparplanStats & {
    plans: (SparplanStats["plans"][number] & {
      symbol: string | null;
      name: string | null;
    })[];
  }
> {
  const ccys = [...new Set(coreTxns.map((t) => t.currency))];
  const rates = await getFxRates(app.db, ccys, display);
  const fx = makeFxRateFn(rates, display);
  const stats = detectSparplans({ txns: coreTxns, displayCurrency: display, fx });
  const meta = await instrumentMeta(
    app,
    stats.plans.map((p) => p.instrumentId),
  );
  return {
    ...stats,
    plans: stats.plans.map((p) => ({
      ...p,
      symbol: meta.get(p.instrumentId)?.symbol ?? null,
      name: meta.get(p.instrumentId)?.name ?? null,
    })),
  };
}

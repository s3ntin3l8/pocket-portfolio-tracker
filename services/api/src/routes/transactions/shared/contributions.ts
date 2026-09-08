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
import { Decimal } from "decimal.js";

export function enrichContributions(
  stats: ContributionStats,
  currentValue: string,
  flows: CashFlowPoint[],
  birthYear: number | null = null,
  portfolioType: "standard" | "child" = "standard",
  opts: {
    totalReturn?: boolean;
    retirementAge?: number | null;
    boundary?: "inside" | "outside";
    monthlyContribution?: string;
  } = {},
) {
  // Money-as-Decimal: every money reduction/compare here runs through Decimal so
  // a long flow list can't accumulate float drift before the pct ratio is
  // computed. The two ratio outputs (simpleGainPct, totalReturnPct) stay as
  // numbers because they're percentages, not money — but their *inputs* are
  // Decimal-derived, so the precision is exact. #S2
  const net = new Decimal(stats.netContributed);
  const currentValueDec = new Decimal(currentValue);
  const simpleGainPct = net.gt(0) ? currentValueDec.minus(net).div(net).toNumber() : null;

  const gross = new Decimal(stats.totalContributed);
  const positiveFlows = flows.reduce((s, f) => {
    const amt = new Decimal(f.amount);
    return amt.gt(0) ? s.plus(amt) : s;
  }, new Decimal(0));
  const totalReturnPct =
    (opts.totalReturn ?? true) && gross.gt(0)
      ? currentValueDec.plus(positiveFlows).minus(gross).div(gross).toNumber()
      : null;

  // xirr takes Number(amount) at its boundary (its Newton-Raphson iteration is
  // float-based), so the conversion here is a deliberate handoff to a float
  // algorithm — not a money computation in this file. #S2 leaves this alone.
  const asOf = new Date();
  const allFlows: CashFlowPoint[] = [...flows, { amount: currentValueDec.toNumber(), date: asOf }];
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
  boundary: "inside" | "outside" = "outside",
  retirementAge: number | null = null,
  monthlyContribution?: string,
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
    boundary,
    monthlyContribution,
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

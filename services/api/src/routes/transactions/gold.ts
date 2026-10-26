import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { accountHolders, loans, portfolios, users } from "@portfolio/db";
import {
  summarizeGoldPlan,
  toDateKey,
  type GoldPlanSummary,
  type HoldingValuation,
} from "@portfolio/core";
import { mapPool } from "../../lib/promise-pool.js";
import {
  instrumentMeta,
  loadValuation,
  PORTFOLIO_VALUATION_CONCURRENCY,
  type PortfolioParams,
} from "./shared.js";

interface GoldHoldingRow {
  portfolioId: string;
  instrumentId: string;
  symbol: string;
  name: string;
  /** Buyback market the holding is priced in (ANTAM / GALERI24 / UBS), or the spot market. */
  market: string;
  grams: string;
  /** Buyback price per gram in the instrument's own currency; null when unpriced. */
  pricePerGram: string | null;
  currency: string | null;
  /** Display-currency values; null when unpriced or no FX rate. */
  value: string | null;
  cost: string | null;
  unrealized: string | null;
  /** No usable price: valued at cost, so there is no measured gain. */
  valuedAtCost: boolean;
  /** No FX rate into the display currency: excluded from every total. */
  fxMissing: boolean;
}

interface GoldPlanRow extends GoldPlanSummary {
  portfolioId: string;
  /** Current buyback value of the plan's gold (display currency); null when unconvertible. */
  value: string | null;
  valuedAtCost: boolean;
  fxMissing: boolean;
}

/**
 * Gold report: every gold holding valued at its buyback rate, plus each financed
 * purchase plan (cicilan) with its progress. Holdings come straight from the portfolio
 * valuation (same numbers as everywhere else); plans are derived by `summarizeGoldPlan`
 * from the loan's schedule and booked legs. Display-currency totals skip rows without a
 * usable FX rate (flagged `fxMissing` — never converted 1:1), and the gain totals skip
 * rows valued at cost so a "measured" gain never includes a made-up zero.
 */
async function buildGoldReport(
  app: FastifyInstance,
  pfs: { id: string; cashCounted: boolean }[],
  display: string,
) {
  const today = toDateKey(new Date());
  const perPortfolio = await mapPool(pfs, PORTFOLIO_VALUATION_CONCURRENCY, async (p) => {
    const { coreTxns, summary } = await loadValuation(app, p.id, display, undefined, p.cashCounted);
    return { portfolioId: p.id, coreTxns, summary };
  });

  const meta = await instrumentMeta(
    app,
    perPortfolio.flatMap((p) => p.summary.holdings.map((h) => h.instrumentId)),
  );
  const isGold = (h: HoldingValuation) => meta.get(h.instrumentId)?.assetClass === "gold";

  const holdings: GoldHoldingRow[] = [];
  const holdingByKey = new Map<string, GoldHoldingRow>();
  for (const { portfolioId, summary } of perPortfolio) {
    for (const h of summary.holdings.filter(isGold)) {
      const im = meta.get(h.instrumentId)!;
      const row: GoldHoldingRow = {
        portfolioId,
        instrumentId: h.instrumentId,
        symbol: im.symbol,
        name: im.displayName ?? im.name,
        market: im.market,
        grams: h.quantity,
        pricePerGram: h.price,
        currency: h.currency,
        value: h.marketValueDisplay,
        cost: h.costBasisDisplay,
        unrealized: h.unrealizedPnLDisplay,
        valuedAtCost: h.valuedAtCost === true,
        fxMissing: h.fxMissing === true,
      };
      holdings.push(row);
      holdingByKey.set(`${portfolioId}:${h.instrumentId}`, row);
    }
  }
  holdings.sort((a, b) => new Decimal(b.value ?? 0).cmp(a.value ?? 0));

  let grams = new Decimal(0);
  let value = new Decimal(0);
  let cost = new Decimal(0);
  let measuredCost = new Decimal(0);
  let unrealized = new Decimal(0);
  for (const h of holdings) {
    grams = grams.add(h.grams);
    // Everything below is a display-currency figure: skip rows with no FX rate (their display
    // value and cost are null) and unpriced rows entirely.
    if (h.fxMissing || h.value === null || h.cost === null) continue;
    value = value.add(h.value);
    cost = cost.add(h.cost);
    if (!h.valuedAtCost && h.unrealized !== null) {
      measuredCost = measuredCost.add(h.cost);
      unrealized = unrealized.add(h.unrealized);
    }
  }

  const loanRows =
    pfs.length === 0
      ? []
      : await app.db
          .select()
          .from(loans)
          .where(
            inArray(
              loans.portfolioId,
              pfs.map((p) => p.id),
            ),
          );
  const txnsByPortfolio = new Map(perPortfolio.map((p) => [p.portfolioId, p.coreTxns]));
  const plans: GoldPlanRow[] = loanRows.map((l) => {
    const s = summarizeGoldPlan(
      {
        id: l.id,
        instrumentId: l.instrumentId,
        provider: l.provider,
        contractNo: l.contractNo,
        currency: l.currency,
        purchasePrice: l.purchasePrice,
        downPayment: l.downPayment,
        principal: l.principal,
        marginTotal: l.marginTotal,
        tenorMonths: l.tenorMonths,
        monthlyInstallment: l.monthlyInstallment,
        startDate: l.startDate,
        schedule: l.schedule,
        closedAt: l.closedAt,
      },
      txnsByPortfolio.get(l.portfolioId) ?? [],
      today,
    );
    const h = holdingByKey.get(`${l.portfolioId}:${l.instrumentId}`);
    return {
      ...s,
      portfolioId: l.portfolioId,
      value: h && !h.fxMissing ? h.value : null,
      valuedAtCost: h?.valuedAtCost ?? false,
      fxMissing: h?.fxMissing ?? false,
    };
  });
  // Open plans first (overdue, then soonest due); finished plans last.
  plans.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return (a.nextDue?.dueDate ?? "9999").localeCompare(b.nextDue?.dueDate ?? "9999");
  });

  // Contract currencies can differ from the display currency, so outstanding principal is
  // reported per currency rather than summed across them.
  const outstanding: Record<string, string> = {};
  for (const p of plans) {
    outstanding[p.currency] = new Decimal(outstanding[p.currency] ?? 0)
      .add(p.outstandingPrincipal)
      .toString();
  }

  return {
    displayCurrency: display,
    totals: {
      grams: grams.toString(),
      value: value.toString(),
      cost: cost.toString(),
      unrealized: unrealized.toString(),
      measuredCost: measuredCost.toString(),
      outstandingByCurrency: outstanding,
    },
    holdings,
    plans,
  };
}

export function registerGoldRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { holderId?: string } }>(
    "/networth/gold",
    { preHandler: app.authenticate },
    async (request, reply) => {
      request.timingName = "GET /networth/gold";
      const id = request.userId;
      const { holderId } = request.query;
      const [u] = await app.db
        .select({ displayCurrency: users.displayCurrency })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      const display = u?.displayCurrency ?? "IDR";

      if (holderId != null) {
        const [holder] = await app.db
          .select()
          .from(accountHolders)
          .where(and(eq(accountHolders.id, holderId), eq(accountHolders.userId, id)))
          .limit(1);
        if (!holder) return reply.code(404).send({ error: "holder_not_found" });
      }

      const pfs = await app.db
        .select({ id: portfolios.id, cashCounted: portfolios.cashCounted })
        .from(portfolios)
        .where(
          holderId != null
            ? and(eq(portfolios.userId, id), eq(portfolios.accountHolderId, holderId))
            : eq(portfolios.userId, id),
        );
      request.timingMeta = { portfolioCount: pfs.length };
      return buildGoldReport(app, pfs, display);
    },
  );

  app.get<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/gold",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request) => {
      request.timingName = "GET /portfolios/:id/gold";
      request.timingMeta = { portfolioId: request.portfolio.id };
      const portfolio = request.portfolio;
      return buildGoldReport(
        app,
        [{ id: portfolio.id, cashCounted: portfolio.cashCounted }],
        portfolio.baseCurrency,
      );
    },
  );
}

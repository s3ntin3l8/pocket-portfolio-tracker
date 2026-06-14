import type { FastifyInstance } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import { instruments, portfolios, transactions } from "@portfolio/db";
import { transactionInputSchema } from "@portfolio/schema";
import {
  computeHoldings,
  summarizePortfolio,
  xirr,
  type CoreTransaction,
  type CashFlowPoint,
} from "@portfolio/core";
import type { InstrumentRef } from "@portfolio/market-data";
import { getMarketData } from "../services/market-data.js";
import { requireUser } from "../plugins/auth.js";

interface PortfolioParams {
  portfolioId: string;
}

export async function transactionsRoute(app: FastifyInstance) {
  // Confirm the portfolio exists and belongs to the user.
  async function ownedPortfolio(userId: string, portfolioId: string) {
    const [p] = await app.db
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
      .limit(1);
    return p ?? null;
  }

  // Load a portfolio's transactions, price its instruments via market data, and
  // value it. Shared by /summary and /performance.
  async function loadValuation(portfolioId: string, baseCurrency: string) {
    const rows = await app.db
      .select()
      .from(transactions)
      .where(eq(transactions.portfolioId, portfolioId));

    const instrumentIds = [
      ...new Set(
        rows.map((r) => r.instrumentId).filter((x): x is string => x !== null),
      ),
    ];
    const instrumentRows = instrumentIds.length
      ? await app.db
          .select()
          .from(instruments)
          .where(inArray(instruments.id, instrumentIds))
      : [];

    const refs = instrumentRows.map((i) => ({
      id: i.id,
      ref: {
        symbol: i.symbol,
        market: i.market,
        assetClass: i.assetClass,
        currency: i.currency,
      } satisfies InstrumentRef,
    }));
    const quotes = await getMarketData().getQuotes(refs);
    const prices: Record<string, { price: string; currency: string }> = {};
    for (const [instrumentId, q] of Object.entries(quotes)) {
      prices[instrumentId] = { price: q.price, currency: q.currency };
    }

    const coreTxns: CoreTransaction[] = rows.map((r) => ({
      instrumentId: r.instrumentId,
      type: r.type,
      quantity: r.quantity,
      price: r.price,
      fees: r.fees,
      currency: r.currency,
      executedAt: r.executedAt,
    }));

    const summary = summarizePortfolio({
      transactions: coreTxns,
      prices,
      displayCurrency: baseCurrency,
    });
    return { coreTxns, summary };
  }

  // List a portfolio's transactions.
  app.get<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/transactions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = requireUser(request);
      if (!(await ownedPortfolio(id, request.params.portfolioId))) {
        return reply.code(404).send({ error: "portfolio_not_found" });
      }
      return app.db
        .select()
        .from(transactions)
        .where(eq(transactions.portfolioId, request.params.portfolioId));
    },
  );

  // Add a transaction to a portfolio.
  app.post<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/transactions",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = requireUser(request);
      const { portfolioId } = request.params;
      if (!(await ownedPortfolio(id, portfolioId))) {
        return reply.code(404).send({ error: "portfolio_not_found" });
      }
      const input = transactionInputSchema.parse({
        ...(request.body as Record<string, unknown>),
        portfolioId,
      });
      const [created] = await app.db
        .insert(transactions)
        .values({
          portfolioId,
          instrumentId: input.instrumentId ?? null,
          type: input.type,
          quantity: input.quantity,
          price: input.price,
          fees: input.fees,
          currency: input.currency,
          executedAt: input.executedAt,
          source: input.source,
          externalId: input.externalId,
        })
        .returning();
      reply.code(201);
      return created;
    },
  );

  // Derived holdings for a portfolio (computed via @portfolio/core).
  app.get<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/holdings",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = requireUser(request);
      const { portfolioId } = request.params;
      if (!(await ownedPortfolio(id, portfolioId))) {
        return reply.code(404).send({ error: "portfolio_not_found" });
      }
      const rows = await app.db
        .select()
        .from(transactions)
        .where(eq(transactions.portfolioId, portfolioId));
      const coreTxns: CoreTransaction[] = rows.map((r) => ({
        instrumentId: r.instrumentId,
        type: r.type,
        quantity: r.quantity,
        price: r.price,
        fees: r.fees,
        currency: r.currency,
        executedAt: r.executedAt,
      }));
      return computeHoldings(coreTxns);
    },
  );

  // Full valuation summary: holdings priced via market data + cash + net worth.
  app.get<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/summary",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = requireUser(request);
      const { portfolioId } = request.params;
      const portfolio = await ownedPortfolio(id, portfolioId);
      if (!portfolio) {
        return reply.code(404).send({ error: "portfolio_not_found" });
      }
      const { summary } = await loadValuation(portfolioId, portfolio.baseCurrency);
      return summary;
    },
  );

  // Money-weighted return (XIRR) from external cash flows + current net worth.
  app.get<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/performance",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = requireUser(request);
      const { portfolioId } = request.params;
      const portfolio = await ownedPortfolio(id, portfolioId);
      if (!portfolio) {
        return reply.code(404).send({ error: "portfolio_not_found" });
      }
      const { coreTxns, summary } = await loadValuation(
        portfolioId,
        portfolio.baseCurrency,
      );

      // External capital flows: deposits in (−), withdrawals out (+).
      const flows: CashFlowPoint[] = [];
      for (const tx of coreTxns) {
        if (tx.type === "deposit") {
          flows.push({ amount: -Number(tx.price), date: tx.executedAt });
        } else if (tx.type === "withdrawal") {
          flows.push({ amount: Number(tx.price), date: tx.executedAt });
        }
      }
      const asOf = new Date();
      flows.push({ amount: Number(summary.netWorth), date: asOf });

      const rate = xirr(flows);
      return {
        xirr: Number.isFinite(rate) ? rate : null,
        netWorth: summary.netWorth,
        asOf: asOf.toISOString(),
      };
    },
  );
}

import type { FastifyInstance } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { Decimal } from "decimal.js";
import { corporateActions, instruments, transactions } from "@portfolio/db";
import { mergerInputSchema } from "@portfolio/schema";
import {
  computeHoldings,
  toDateKey,
  type CoreTransaction,
  type CorporateAction,
} from "@portfolio/core";
import { enqueueRecompute } from "../services/scheduler.js";
import { toCoreTxns } from "../services/tx-core.js";

export async function mergersRoute(app: FastifyInstance) {
  // Record a fund merger (Fondsverschmelzung / ISIN change) as a paired sell+buy, both
  // tagged `kind:"merger"`. The sell closes the old position; the buy opens the new one,
  // carrying cost basis (tax-neutral) or stepping up to market and realizing the gain
  // (taxable). Written as one two-row insert, so the pair lands atomically. Everything
  // downstream (holdings, TWR, trade log) treats them as ordinary trades; only
  // `contributions.ts` special-cases `kind:"merger"` to stay contribution-neutral.
  app.post<{ Params: { portfolioId: string } }>(
    "/portfolios/:portfolioId/mergers",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const { portfolioId } = request.params;

      const input = mergerInputSchema.parse({
        ...(request.body as Record<string, unknown>),
        portfolioId,
      });

      // Both instruments must exist and share a currency (cost basis is currency-blind,
      // and the legs must net to zero cash, so a cross-currency merger isn't supported).
      const instRows = await app.db
        .select()
        .from(instruments)
        .where(inArray(instruments.id, [input.fromInstrumentId, input.toInstrumentId]));
      const from = instRows.find((i) => i.id === input.fromInstrumentId);
      const to = instRows.find((i) => i.id === input.toInstrumentId);
      if (!from || !to) return reply.code(404).send({ error: "instrument_not_found" });
      if (from.currency !== to.currency) {
        return reply.code(400).send({ error: "currency_mismatch" });
      }
      const currency = from.currency;

      const outQty = new Decimal(input.outQty);
      const inQty = new Decimal(input.inQty);
      if (outQty.lte(0) || inQty.lte(0)) {
        return reply.code(400).send({ error: "quantities_must_be_positive" });
      }

      // Current holding of the old instrument → average cost / basis for the carry.
      const rows = await app.db
        .select()
        .from(transactions)
        .where(eq(transactions.portfolioId, portfolioId));
      const coreTxns: CoreTransaction[] = toCoreTxns(rows);
      const caRows = await app.db
        .select()
        .from(corporateActions)
        .where(
          inArray(corporateActions.instrumentId, [input.fromInstrumentId, input.toInstrumentId]),
        );
      const cas: CorporateAction[] = caRows.map((r) => ({
        instrumentId: r.instrumentId,
        type: r.type,
        ratio: r.ratio,
        exDate: new Date(r.exDate),
      }));
      const holding = computeHoldings(coreTxns, cas).find(
        (h) => h.instrumentId === input.fromInstrumentId,
      );
      if (!holding || new Decimal(holding.quantity).lte(0)) {
        return reply.code(400).send({ error: "no_position_to_merge" });
      }
      const avgCost = new Decimal(holding.avgCost);

      // Sell leg price and buy leg total. Taxable → at market (realize the gain, new
      // basis steps up to market value); neutral → carry the basis of the merged-out
      // shares (avgCost × outQty — equals the full position basis for a 100% merger),
      // so the sell realizes nothing and the basis lands intact on the new instrument.
      const sellPrice = input.taxable ? new Decimal(input.marketValue!).div(outQty) : avgCost;
      const buyTotal = input.taxable ? new Decimal(input.marketValue!) : avgCost.mul(outQty);
      const buyPrice = buyTotal.div(inQty);

      const dateStr = toDateKey(input.executedAt);
      const legs = [
        {
          portfolioId,
          instrumentId: input.fromInstrumentId,
          type: "sell" as const,
          quantity: outQty.toString(),
          price: sellPrice.toString(),
          fees: "0",
          currency,
          executedAt: input.executedAt,
          kind: "merger",
          source: "manual" as const,
          externalId: `merger:out:${input.fromInstrumentId}:${dateStr}`,
        },
        {
          portfolioId,
          instrumentId: input.toInstrumentId,
          type: "buy" as const,
          quantity: inQty.toString(),
          price: buyPrice.toString(),
          fees: "0",
          currency,
          executedAt: input.executedAt,
          kind: "merger",
          source: "manual" as const,
          externalId: `merger:in:${input.toInstrumentId}:${dateStr}`,
        },
      ];

      // The legs and the corporate-action reference row commit or roll back together —
      // wrapping in a single transaction guarantees we never leave an orphaned sell+buy
      // pair persisted without its CA reference row (or vice-versa). The CA row is the
      // domain-correct record of the merger; the transaction pair is the per-portfolio
      // tax/economics materialization.
      //
      // Ratio semantics: `ratio` is source-per-target (outQty ÷ inQty — old shares per
      // new share), `ratioTo` is its reciprocal (target-per-source — new shares per old
      // share). These are intentionally stored as a pair so Phase 2's auto-apply engine
      // can pick whichever orientation it needs without re-deriving. Don't change the
      // orientation without checking #527 — this repo's split-adjustment math has a
      // history of subtle ratio-direction bugs.
      let created: (typeof transactions.$inferSelect)[];
      let ca: typeof corporateActions.$inferSelect;
      try {
        const result = await app.db.transaction(async (tx) => {
          const insertedLegs = await tx.insert(transactions).values(legs).returning();
          const [insertedCa] = await tx
            .insert(corporateActions)
            .values({
              instrumentId: input.fromInstrumentId,
              type: "merger",
              ratio: outQty.div(inQty).toString(),
              exDate: dateStr,
              targetInstrumentId: input.toInstrumentId,
              ratioTo: inQty.div(outQty).toString(),
              taxableMarketValue: input.taxable ? input.marketValue : null,
            })
            .returning();
          return { insertedLegs, insertedCa };
        });
        created = result.insertedLegs;
        ca = result.insertedCa;
      } catch (err) {
        // The legs share a deterministic externalId per side, so re-recording the same
        // merger trips the (portfolioId, source, externalId) unique index — surface that
        // as a friendly 409 rather than a 500. Postgres unique-violation is 23505;
        // drizzle/PGlite may nest it under `cause`, so also match the message as a
        // fallback across drivers. The transaction wrapper guarantees the legs and the
        // CA row share a fate, so catching here rolls both back.
        const e = err as { code?: string; cause?: { code?: string }; message?: string };
        if (
          e.code === "23505" ||
          e.cause?.code === "23505" ||
          /duplicate key|unique constraint/i.test(e.message ?? "")
        ) {
          return reply.code(409).send({ error: "merger_already_recorded" });
        }
        throw err;
      }
      await enqueueRecompute(portfolioId, dateStr);
      reply.code(201);
      return { transactions: created, corporateAction: ca };
    },
  );
}

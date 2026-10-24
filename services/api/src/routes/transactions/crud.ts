import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { and, eq, inArray, lte } from "drizzle-orm";
import { transactions, trResolvedEvents, dismissedAnomalies } from "@portfolio/db";
import { transactionInputSchema } from "@portfolio/schema";
import { toDateKey } from "@portfolio/core";
import { enqueueRecompute } from "../../services/scheduler.js";
import { reassignTransactions } from "../../services/reassign.js";
import { mergeTransactions, previewMerge, MergeBlockedError } from "../../services/merge.js";
import { deleteReceiptsForTransactions } from "../../storage/receipts.js";
import { ownedPortfolio } from "../helpers.js";
import {
  LoanActionError,
  isAutoBookedLeg,
  onLoanLegsDeleted,
  validateLoanLink,
} from "../../services/loan-actions.js";
import type { PortfolioParams } from "./shared.js";
import { bulkDeleteSchema } from "./shared.js";

/** Run a loan-linking write; an invalid link is the caller's input, not a 500. */
async function withLoanErrors<T>(reply: FastifyReply, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LoanActionError) return reply.code(err.status).send({ error: err.code });
    throw err;
  }
}

export function registerCrudRoutes(app: FastifyInstance) {
  app.post<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/transactions",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const { portfolioId } = request.params;
      const input = transactionInputSchema.parse({
        ...(request.body as Record<string, unknown>),
        portfolioId,
      });
      const created = await withLoanErrors(reply, () =>
        app.db.transaction(async (tx) => {
          if (input.loanId) {
            await validateLoanLink(tx, portfolioId, {
              loanId: input.loanId,
              installmentN: input.installmentN,
              currency: input.currency,
            });
          }
          const [row] = await tx
            .insert(transactions)
            .values({
              portfolioId,
              instrumentId: input.instrumentId ?? null,
              type: input.type,
              quantity: input.quantity,
              price: input.price,
              fees: input.fees,
              tax: input.tax ?? null,
              fxRate: input.fxRate ?? null,
              perShare: input.perShare ?? null,
              shares: input.shares ?? null,
              nativeCurrency: input.nativeCurrency ?? null,
              grossNative: input.grossNative ?? null,
              description: input.description ?? null,
              tags: input.tags ?? null,
              currency: input.currency,
              executedAt: input.executedAt,
              source: input.source,
              externalId: input.externalId,
              kind: input.kind ?? null,
              loanId: input.loanId ?? null,
              installmentN: input.loanId ? (input.installmentN ?? null) : null,
              idReinvested: input.idReinvested ?? false,
            })
            .returning();
          return row!;
        }),
      );
      if (reply.sent) return reply;
      await enqueueRecompute(portfolioId, toDateKey(new Date(input.executedAt)));
      reply.code(201);
      return created;
    },
  );

  app.delete<{ Params: PortfolioParams & { txId: string } }>(
    "/portfolios/:portfolioId/transactions/:txId",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const { portfolioId, txId } = request.params;
      // Deleting an auto-booked installment (or a payoff) is a deliberate departure from the
      // schedule: flag it in the same db transaction so the booking job doesn't undo it.
      const deleted = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .delete(transactions)
          .where(and(eq(transactions.id, txId), eq(transactions.portfolioId, portfolioId)))
          .returning();
        if (row) await onLoanLegsDeleted(tx, [row]);
        return row;
      });
      if (!deleted) {
        return reply.code(404).send({ error: "transaction_not_found" });
      }
      await deleteReceiptsForTransactions(
        app,
        [deleted.id],
        deleted.importId ? [deleted.importId] : [],
      );
      await enqueueRecompute(portfolioId, toDateKey(deleted.executedAt));
      return reply.code(204).send();
    },
  );

  app.post<{ Params: PortfolioParams; Body: { ids?: unknown } }>(
    "/portfolios/:portfolioId/transactions/bulk-delete",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request) => {
      const { portfolioId } = request.params;
      const { ids } = bulkDeleteSchema.parse(request.body);
      const deleted = await app.db.transaction(async (tx) => {
        const rows = await tx
          .delete(transactions)
          .where(and(eq(transactions.portfolioId, portfolioId), inArray(transactions.id, ids)))
          .returning({
            id: transactions.id,
            importId: transactions.importId,
            executedAt: transactions.executedAt,
            type: transactions.type,
            loanId: transactions.loanId,
            installmentN: transactions.installmentN,
            externalId: transactions.externalId,
          });
        await onLoanLegsDeleted(tx, rows);
        return rows;
      });
      if (deleted.length > 0) {
        await deleteReceiptsForTransactions(
          app,
          deleted.map((d) => d.id),
          deleted.map((d) => d.importId).filter((x): x is string => x !== null),
        );
        const fromDate = deleted.map((d) => toDateKey(d.executedAt)).sort()[0]!;
        await enqueueRecompute(portfolioId, fromDate);
      }
      return { deleted: deleted.length };
    },
  );

  app.patch<{ Params: PortfolioParams & { txId: string } }>(
    "/portfolios/:portfolioId/transactions/:txId",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const { portfolioId, txId } = request.params;
      const input = transactionInputSchema.parse({
        ...(request.body as Record<string, unknown>),
        portfolioId,
      });
      const [previous] = await app.db
        .select({
          executedAt: transactions.executedAt,
          loanId: transactions.loanId,
          installmentN: transactions.installmentN,
          externalId: transactions.externalId,
        })
        .from(transactions)
        .where(and(eq(transactions.id, txId), eq(transactions.portfolioId, portfolioId)))
        .limit(1);
      if (!previous) {
        return reply.code(404).send({ error: "transaction_not_found" });
      }
      // The link follows the row's type; an omitted loanId/installmentN leaves it as stored
      // (a client that doesn't know about links must not wipe one), `null` unlinks.
      const isRepayment = input.type === "loan_repayment";
      const loanId = !isRepayment
        ? null
        : input.loanId === undefined
          ? previous.loanId
          : input.loanId;
      const installmentN =
        loanId === null
          ? null
          : input.installmentN !== undefined
            ? input.installmentN
            : loanId === previous.loanId
              ? previous.installmentN
              : null;
      const linkChanged = loanId !== previous.loanId || installmentN !== previous.installmentN;
      // An auto-booked installment/payoff is the schedule's own row; re-pointing it would
      // desync it from its externalId and the schedule.
      if (linkChanged && isAutoBookedLeg(previous.externalId)) {
        return reply.code(409).send({ error: "loan_link_locked" });
      }
      const updated = await withLoanErrors(reply, () =>
        app.db.transaction(async (tx) => {
          if (linkChanged && loanId !== null) {
            await validateLoanLink(tx, portfolioId, {
              loanId,
              installmentN,
              currency: input.currency,
              excludeTxId: txId,
            });
          }
          const [row] = await tx
            .update(transactions)
            .set({
              instrumentId: input.instrumentId ?? null,
              type: input.type,
              quantity: input.quantity,
              price: input.price,
              fees: input.fees,
              tax: input.tax ?? null,
              fxRate: input.fxRate ?? null,
              perShare: input.perShare ?? null,
              shares: input.shares ?? null,
              nativeCurrency: input.nativeCurrency ?? null,
              grossNative: input.grossNative ?? null,
              description: input.description ?? null,
              tags: input.tags ?? null,
              currency: input.currency,
              executedAt: input.executedAt,
              source: input.source,
              externalId: input.externalId,
              kind: input.kind ?? null,
              loanId,
              installmentN,
              idReinvested: input.idReinvested ?? false,
            })
            .where(and(eq(transactions.id, txId), eq(transactions.portfolioId, portfolioId)))
            .returning();
          return row;
        }),
      );
      if (reply.sent) return reply;
      if (!updated) {
        return reply.code(404).send({ error: "transaction_not_found" });
      }
      const fromDate = [previous.executedAt, updated.executedAt]
        .filter((date): date is Date => date instanceof Date)
        .map(toDateKey)
        .sort()[0]!;
      await enqueueRecompute(portfolioId, fromDate);
      return updated;
    },
  );

  const statusBodySchema = z.object({
    status: z.enum(["normal", "archived", "cash_neutral"]),
  });
  app.patch<{ Params: PortfolioParams & { txId: string } }>(
    "/portfolios/:portfolioId/transactions/:txId/status",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const { portfolioId, txId } = request.params;
      const { status } = statusBodySchema.parse(request.body);
      // Promoting a draft to a counting status is a confirm too — same cost-basis gate as
      // resolve-drafts (audit B4), so a price-0 transfer_in can't slip around it here.
      if (status !== "archived") {
        const [blocked] = await app.db
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.id, txId),
              eq(transactions.portfolioId, portfolioId),
              eq(transactions.status, "draft"),
              eq(transactions.type, "transfer_in"),
              lte(transactions.price, "0"),
            ),
          )
          .limit(1);
        if (blocked) {
          return reply
            .code(400)
            .send({ error: "transfer_cost_basis_required", transactionIds: [blocked.id] });
        }
      }
      // Promoting a draft to a counting status is a confirm — it must record the broker
      // event in the resolved-events ledger, exactly like `resolve-drafts` does. Without it
      // the event was only seeded at the next sync, so deleting the row before that sync
      // re-surfaced the trade.
      const updated = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .update(transactions)
          .set({ status })
          .where(and(eq(transactions.id, txId), eq(transactions.portfolioId, portfolioId)))
          .returning();
        if (!row) return null;
        if ((row.source === "pytr" || row.source === "ibkr") && row.externalId) {
          await tx
            .insert(trResolvedEvents)
            .values({
              portfolioId,
              source: row.source as "pytr" | "ibkr",
              eventId: row.externalId,
              resolution: status === "archived" ? "discarded" : "confirmed",
            })
            .onConflictDoNothing();
        }
        return row;
      });
      if (!updated) {
        return reply.code(404).send({ error: "transaction_not_found" });
      }
      await enqueueRecompute(portfolioId, toDateKey(updated.executedAt));
      return updated;
    },
  );

  const dismissAnomalySchema = z.object({
    transactionId: z.guid(),
    code: z.string().min(1),
  });
  app.post<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/anomalies/dismiss",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const id = request.userId;
      const { portfolioId } = request.params;
      const { transactionId, code } = dismissAnomalySchema.parse(request.body);
      const [tx] = await app.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.id, transactionId), eq(transactions.portfolioId, portfolioId)))
        .limit(1);
      if (!tx) {
        return reply.code(404).send({ error: "transaction_not_found" });
      }
      await app.db
        .insert(dismissedAnomalies)
        .values({ userId: id, portfolioId, transactionId, code })
        .onConflictDoNothing();
      return reply.code(204).send();
    },
  );
  app.delete<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/anomalies/dismiss",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const { portfolioId } = request.params;
      const { transactionId, code } = dismissAnomalySchema.parse(request.body);
      await app.db
        .delete(dismissedAnomalies)
        .where(
          and(
            eq(dismissedAnomalies.portfolioId, portfolioId),
            eq(dismissedAnomalies.transactionId, transactionId),
            eq(dismissedAnomalies.code, code),
          ),
        );
      return reply.code(204).send();
    },
  );

  const resolveDraftsSchema = z.object({
    ids: z.array(z.string().uuid()).min(1),
    action: z.enum(["confirm", "discard"]),
  });
  app.post<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/transactions/resolve-drafts",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const { portfolioId } = request.params;
      const { ids, action } = resolveDraftsSchema.parse(request.body);
      // Same gate as POST /imports/:id/confirm (audit B4): a synced inbound depot transfer
      // with no carried cost basis (price 0) can't be confirmed until the user edits the
      // draft's price — it would otherwise land at zero cost basis. All-or-nothing, so a
      // batch confirm never half-applies.
      if (action === "confirm") {
        const blocked = await app.db
          .select({ id: transactions.id })
          .from(transactions)
          .where(
            and(
              eq(transactions.portfolioId, portfolioId),
              eq(transactions.status, "draft"),
              eq(transactions.type, "transfer_in"),
              lte(transactions.price, "0"),
              inArray(transactions.id, ids),
            ),
          );
        if (blocked.length > 0) {
          return reply.code(400).send({
            error: "transfer_cost_basis_required",
            transactionIds: blocked.map((r) => r.id),
          });
        }
      }
      const nextStatus = action === "confirm" ? "normal" : "archived";
      const resolution = action === "confirm" ? "confirmed" : "discarded";

      // The status change and the ledger entry are one transaction: a crash between them
      // used to leave a `normal` row with no ledger entry, so the broker event re-surfaced
      // on the next sync and the trade was imported twice.
      const updated = await app.db.transaction(async (tx) => {
        const rows = await tx
          .update(transactions)
          .set({ status: nextStatus })
          .where(
            and(
              eq(transactions.portfolioId, portfolioId),
              eq(transactions.status, "draft"),
              inArray(transactions.id, ids),
            ),
          )
          .returning({
            id: transactions.id,
            source: transactions.source,
            externalId: transactions.externalId,
            executedAt: transactions.executedAt,
          });

        const ledgerRows = rows
          .filter((r) => (r.source === "pytr" || r.source === "ibkr") && r.externalId)
          .map((r) => ({
            portfolioId,
            source: r.source as "pytr" | "ibkr",
            eventId: r.externalId as string,
            resolution,
          }));
        if (ledgerRows.length > 0) {
          await tx.insert(trResolvedEvents).values(ledgerRows).onConflictDoNothing();
        }
        return rows;
      });

      const days = new Set(updated.map((r) => toDateKey(r.executedAt)));
      for (const day of days) await enqueueRecompute(portfolioId, day);

      return { updated: updated.length };
    },
  );

  const reassignSchema = z.object({
    ids: z.array(z.string().uuid()).min(1),
    targetPortfolioId: z.string().uuid(),
  });
  app.post<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/transactions/reassign",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const id = request.userId;
      const { portfolioId } = request.params;
      const { ids, targetPortfolioId } = reassignSchema.parse(request.body);
      if (portfolioId === targetPortfolioId) {
        return reply.code(400).send({ error: "same_portfolio" });
      }
      if (!(await ownedPortfolio(app, id, targetPortfolioId))) {
        return reply.code(404).send({ error: "portfolio_not_found" });
      }

      const res = await reassignTransactions(app.db, {
        rowIds: ids,
        fromPortfolioId: portfolioId,
        toPortfolioId: targetPortfolioId,
      });
      for (const { portfolioId: pid, day } of res.recompute) await enqueueRecompute(pid, day);

      return {
        moved: res.moved,
        skippedConflicts: res.skippedConflicts,
        skippedLoans: res.skippedLoans,
      };
    },
  );

  app.get<{ Params: PortfolioParams; Querystring: { survivorId?: string; absorbedId?: string } }>(
    "/portfolios/:portfolioId/transactions/merge-preview",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const { portfolioId } = request.params;
      const query = z
        .object({ survivorId: z.uuid(), absorbedId: z.uuid() })
        .safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: "invalid_query" });

      const preview = await previewMerge(app.db, { portfolioId, ...query.data });
      return preview;
    },
  );

  const mergeSchema = z
    .object({ survivorId: z.uuid(), absorbedId: z.uuid() })
    .refine((v) => v.survivorId !== v.absorbedId, { message: "same_transaction" });
  app.post<{ Params: PortfolioParams }>(
    "/portfolios/:portfolioId/transactions/merge",
    { preHandler: [app.authenticate, app.requirePortfolio] },
    async (request, reply) => {
      const { portfolioId } = request.params;
      const parsed = mergeSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

      try {
        const result = await mergeTransactions(app.db, { portfolioId, ...parsed.data });
        for (const { portfolioId: pid, day } of result.recompute) await enqueueRecompute(pid, day);
        return { survivorId: result.survivorId };
      } catch (err) {
        if (err instanceof MergeBlockedError) {
          const status = err.reason === "not_found" ? 404 : 400;
          return reply.code(status).send({ error: `cannot_merge_${err.reason}` });
        }
        throw err;
      }
    },
  );
}

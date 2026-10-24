import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { portfolios, screenshotImports, transactionSources } from "@portfolio/db";
import type { ParsedTransaction } from "@portfolio/schema";
import { parsedTransactionSchema } from "@portfolio/schema";
import { parserToTxSource, isEuParser } from "../../services/parsers/dedup.js";
import { materializeDrafts, type DuplicateMatch } from "../../services/materialize-drafts.js";
import {
  finalizeReceipts,
  retainDocumentForTransaction,
  getDocumentForImport,
} from "../../storage/receipts.js";
import { accountMismatchVerdict } from "./helpers.js";
import { ownedPortfolio } from "../helpers.js";

const materializeBodySchema = z.object({
  portfolioId: z.string().uuid(),
  acknowledgeAccountMismatch: z.boolean().default(false),
  // Clears a duplicate-409: the user consciously chose to import the flagged duplicates.
  // A duplicate of a *pending* row still needs a per-row decision — the blanket flag never
  // clears those.
  acknowledgeDuplicates: z.boolean().default(false),
  // Per-draft dispositions for the duplicates the server reported — the same vocabulary
  // the confirm route accepts, so a conflict that cannot be cleared by the blanket flag
  // (a pending row) can still be resolved here.
  resolutions: z
    .array(
      z.object({
        draftIndex: z.number().int().nonnegative(),
        action: z.enum(["skip", "import", "enrich"]),
      }),
    )
    .default([]),
});

const accountCheckBodySchema = z.object({
  units: z.array(z.object({ importId: z.string().uuid(), portfolioId: z.string().uuid() })).max(50),
});

export function registerMaterializeRoutes(app: FastifyInstance) {
  async function materializeResolvedDrafts(opts: {
    imp: { id: string };
    drafts: ParsedTransaction[];
    parserTag: string;
    targetPortfolioId: string;
    acknowledgeDuplicates?: boolean;
    resolutions?: Array<{ draftIndex: number; action: "skip" | "import" | "enrich" }>;
  }): Promise<
    | { kind: "duplicate"; plainDuplicates: DuplicateMatch[]; pendingDuplicates: DuplicateMatch[] }
    | {
        kind: "ok";
        materialized: number;
        enriched: number;
        matchedTransactionIds: string[];
      }
  > {
    const { imp, drafts, parserTag, targetPortfolioId, acknowledgeDuplicates, resolutions } = opts;
    const [pf] = await app.db
      .select({
        documentRetention: portfolios.documentRetention,
      })
      .from(portfolios)
      .where(eq(portfolios.id, targetPortfolioId))
      .limit(1);

    // Cash transactions are always imported — the portfolio's `cashCounted` boundary
    // decides whether they are counted and shown, both of which are read-time decisions
    // over the stored rows (see routes/imports/confirm.ts for the same reasoning).

    const res = await materializeDrafts(app, {
      drafts,
      targetPortfolioId,
      source: parserToTxSource(parserTag) as "csv" | "pdf" | "ibkr" | "screenshot" | "manual",
      importId: imp.id,
      status: "draft",
      isEu: isEuParser(parserTag),
      euWhenIsin: parserTag === "ai",
      mode: "user",
      acknowledgeDuplicates,
      resolutions,
    });

    // A duplicate that needs a decision blocks the import — exactly like the confirm
    // path. The materialization path and the confirm path must agree: the same file
    // imported through either entry point has to behave the same way.
    if (res.kind === "duplicate") {
      return {
        kind: "duplicate",
        plainDuplicates: res.plainDuplicates,
        pendingDuplicates: res.pendingDuplicates,
      };
    }

    await app.db
      .update(screenshotImports)
      .set({ portfolioId: targetPortfolioId, status: "confirmed" })
      .where(eq(screenshotImports.id, imp.id));

    const retain = pf?.documentRetention ?? false;

    if (retain && res.matchedTransactionIds.length > 0) {
      for (const matchedTransactionId of res.matchedTransactionIds) {
        try {
          await retainDocumentForTransaction(app, {
            importId: imp.id,
            transactionId: matchedTransactionId,
            portfolioId: targetPortfolioId,
          });
        } catch (err) {
          app.log.warn(
            { err, importId: imp.id, matchedTransactionId },
            "retainDocumentForTransaction failed after materialize (non-fatal)",
          );
        }
      }
    }

    try {
      await finalizeReceipts(app, {
        importId: imp.id,
        portfolioId: targetPortfolioId,
        retain,
      });
    } catch (err) {
      app.log.warn(
        { err, importId: imp.id },
        "finalizeReceipts failed after materialize (non-fatal) — import stays confirmed",
      );
    }

    if ((parserTag === "dkb-pdf" || parserTag === "tr-pdf") && retain) {
      try {
        const retainedDoc = await getDocumentForImport(app, imp.id);
        if (retainedDoc) {
          await app.db
            .update(transactionSources)
            .set({ documentId: retainedDoc.id })
            .where(
              and(eq(transactionSources.importId, imp.id), isNull(transactionSources.documentId)),
            );
        }
      } catch (err) {
        app.log.warn(
          { err, importId: imp.id },
          "materialize: failed to link PDF source rows to document (non-fatal)",
        );
      }
    }

    return {
      kind: "ok",
      materialized: res.written.length,
      enriched: res.enriched,
      matchedTransactionIds: res.matchedTransactionIds,
    };
  }

  app.post<{ Params: { importId: string } }>(
    "/imports/:importId/materialize",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const id = request.userId;
      const { portfolioId, acknowledgeAccountMismatch, acknowledgeDuplicates, resolutions } =
        materializeBodySchema.parse(request.body);

      const [imp] = await app.db
        .select()
        .from(screenshotImports)
        .where(
          and(eq(screenshotImports.id, request.params.importId), eq(screenshotImports.userId, id)),
        )
        .limit(1);
      if (!imp) return reply.code(404).send({ error: "import_not_found" });
      if (imp.status === "confirmed") {
        return reply.code(409).send({ error: "already_confirmed" });
      }

      const parsed = (imp.parsedJson ?? {}) as {
        drafts?: unknown[];
        contracts?: unknown[];
        accountNumber?: string | null;
      };
      const drafts = z
        .array(parsedTransactionSchema)
        .parse(Array.isArray(parsed.drafts) ? parsed.drafts : []);
      const contracts = Array.isArray(parsed.contracts) ? parsed.contracts : [];
      if (contracts.length > 0) {
        return reply.code(400).send({ error: "use_confirm_for_contracts" });
      }
      if (drafts.length === 0) {
        return reply.code(400).send({ error: "nothing_to_materialize" });
      }

      const targetPortfolio = await ownedPortfolio(app, id, portfolioId);
      if (!targetPortfolio) return reply.code(404).send({ error: "portfolio_not_found" });

      if (!acknowledgeAccountMismatch && imp.parser !== "pytr") {
        const mismatch = await accountMismatchVerdict(app, id, parsed.accountNumber, portfolioId);
        if (mismatch) {
          request.log.info(
            { importId: imp.id, kind: mismatch.kind },
            "materialize blocked: account mismatch",
          );
          return reply.code(409).send({ error: "account_mismatch", ...mismatch });
        }
      }

      const mat = await materializeResolvedDrafts({
        imp,
        drafts,
        parserTag: imp.parser ?? "csv",
        targetPortfolioId: portfolioId,
        acknowledgeDuplicates,
        resolutions,
      });
      if (mat.kind === "duplicate") {
        // Same 409 shape as the confirm path, so the client handles both entry points
        // identically.
        const isoDay = (v: Date | string) =>
          (v instanceof Date ? v.toISOString() : new Date(v).toISOString()).slice(0, 10);
        const describe = (entry: DuplicateMatch, pending: boolean) => {
          const d = drafts[entry.draftIndex];
          return {
            draftIndex: entry.draftIndex,
            externalId: d?.externalId ?? `import:${imp.id}:${entry.draftIndex}`,
            matchedTransactionId: entry.matched.id,
            name: d?.name ?? d?.isin ?? d?.ticker ?? null,
            action: d?.action ?? null,
            quantity: d?.quantity ?? null,
            executedAt: d ? isoDay(d.executedAt) : null,
            matchedSource: entry.matched.source,
            matchedExecutedAt: isoDay(entry.matched.executedAt),
            pending,
          };
        };
        request.log.info(
          {
            importId: imp.id,
            duplicates: mat.plainDuplicates.length,
            pending: mat.pendingDuplicates.length,
          },
          "materialize blocked: cross-source duplicates",
        );
        return reply.code(409).send({
          error: "duplicate_transactions",
          count: mat.plainDuplicates.length + mat.pendingDuplicates.length,
          duplicates: [
            ...mat.plainDuplicates.map((d) => describe(d, false)),
            ...mat.pendingDuplicates.map((d) => describe(d, true)),
          ],
        });
      }
      request.log.info(
        { importId: imp.id, materialized: mat.materialized, portfolioId },
        "import materialized as drafts",
      );
      reply.code(201);
      return {
        importId: imp.id,
        materialized: true,
        portfolioId,
        materializedCount: mat.materialized,
        enrichedCount: mat.enriched,
      };
    },
  );

  app.post("/imports/account-check", { preHandler: app.authenticate }, async (request) => {
    const id = request.userId;
    const { units } = accountCheckBodySchema.parse(request.body);

    const mismatches: Array<
      { importId: string } & NonNullable<Awaited<ReturnType<typeof accountMismatchVerdict>>>
    > = [];

    for (const unit of units) {
      const [imp] = await app.db
        .select()
        .from(screenshotImports)
        .where(and(eq(screenshotImports.id, unit.importId), eq(screenshotImports.userId, id)))
        .limit(1);
      if (!imp || imp.status === "confirmed" || imp.parser === "pytr") continue;

      const parsed = (imp.parsedJson ?? {}) as { accountNumber?: string | null };
      const verdict = await accountMismatchVerdict(app, id, parsed.accountNumber, unit.portfolioId);
      if (verdict) mismatches.push({ importId: imp.id, ...verdict });
    }

    return { mismatches };
  });
}

import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { portfolios } from "@portfolio/db";
import {
  proposeTransactionsBodySchema,
  transferNeedsCostBasis,
  type ParsedTransaction,
} from "@portfolio/schema";
import { assignContentExternalIds } from "../../services/parsers/hash.js";
import {
  annotateLikelyDuplicates,
  existingImport,
  insertDraftImport,
  resolveReuse,
  soleOwnedPortfolioId,
} from "./parse/helpers.js";

/** Parser tag of AI-proposed imports (maps to the `manual` transaction source). */
export const AI_PARSER = "ai";
/** Fixed, never model-controlled: a proposal is always low-confidence until the user checks it. */
const PROPOSAL_CONFIDENCE = 0.5;

/** Stable across key order and re-proposal, so the same content is the same import. */
function proposalHash(portfolioId: string | null, drafts: ParsedTransaction[]): string {
  const canonical = drafts.map((d) =>
    JSON.stringify([
      d.action,
      d.assetClass ?? null,
      d.ticker ?? null,
      d.isin ?? null,
      d.wkn ?? null,
      d.name ?? null,
      d.quantity,
      d.unit ?? null,
      d.price,
      d.fees,
      d.total ?? null,
      d.currency,
      d.executedAt instanceof Date ? d.executedAt.toISOString() : d.executedAt,
      d.exchangeCode ?? null,
      d.description ?? null,
    ]),
  );
  return `ai:${createHash("sha256")
    .update(JSON.stringify([portfolioId, canonical]))
    .digest("hex")}`;
}

/**
 * `POST /imports/propose` — AI-assisted entry. Creates a *draft import* from transactions a
 * model extracted (e.g. from a pasted broker email); nothing is committed. The user reviews
 * and confirms it in the existing import review screen, which applies every confirm-time
 * gate (account mismatch, transfer cost basis, cross-source duplicate acknowledgement).
 *
 * Mutating POST without `scope: "read"`, so a read-only token is refused by the auth plugin.
 */
export function registerProposeRoute(app: FastifyInstance) {
  /** Absolute review link when the web origin is configured (external AI clients need one). */
  const reviewUrl = (path: string) => {
    const base = app.config.PUBLIC_WEB_URL.trim().replace(/\/+$/, "");
    return base ? { reviewUrl: `${base}${path}` } : {};
  };

  app.post("/imports/propose", { preHandler: app.authenticate }, async (request, reply) => {
    const userId = request.userId;
    const body = proposeTransactionsBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: body.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    let portfolioId: string | null = null;
    if (body.data.portfolioId) {
      const [own] = await app.db
        .select({ id: portfolios.id })
        .from(portfolios)
        .where(and(eq(portfolios.id, body.data.portfolioId), eq(portfolios.userId, userId)))
        .limit(1);
      if (!own) return reply.code(404).send({ error: "portfolio_not_found" });
      portfolioId = own.id;
    }

    const drafts: ParsedTransaction[] = body.data.transactions.map((t) => ({
      ...t,
      executedAt: new Date(t.executedAt),
      currency: t.currency.toUpperCase(),
      confidence: PROPOSAL_CONFIDENCE,
      ...(transferNeedsCostBasis(t) ? { attention: ["needs_cost_basis" as const] } : {}),
    }));
    const contentHash = proposalHash(portfolioId, drafts);

    const reuse = await resolveReuse(app, await existingImport(app, userId, contentHash), false);
    if (reuse) {
      const isDraft = reuse.status === "draft";
      return reply.code(200).send({
        importId: reuse.id,
        draftCount: body.data.transactions.length,
        alreadyExists: isDraft,
        alreadyConfirmed: !isDraft,
        likelyDuplicates: 0,
        portfolioId: reuse.portfolioId ?? portfolioId,
        reviewPath: `/transactions/import/${reuse.id}`,
        ...reviewUrl(`/transactions/import/${reuse.id}`),
      });
    }

    assignContentExternalIds(drafts, AI_PARSER);
    const candidate = portfolioId ?? (await soleOwnedPortfolioId(app, userId));
    await annotateLikelyDuplicates(app, drafts, candidate, AI_PARSER);

    const imp = await insertDraftImport(app, {
      userId,
      portfolioId,
      parser: AI_PARSER,
      parsedJson: { drafts, errors: [] },
      contentHash,
    });

    const likelyDuplicates = drafts.filter(
      (d) => (d as { likelyDuplicate?: unknown }).likelyDuplicate,
    ).length;
    request.log.info(
      { importId: imp.id, drafts: drafts.length, likelyDuplicates },
      "ai proposal stored as draft import",
    );
    return reply.code(201).send({
      importId: imp.id,
      draftCount: drafts.length,
      alreadyExists: false,
      alreadyConfirmed: false,
      likelyDuplicates,
      portfolioId: candidate,
      reviewPath: `/transactions/import/${imp.id}`,
      ...reviewUrl(`/transactions/import/${imp.id}`),
    });
  });
}

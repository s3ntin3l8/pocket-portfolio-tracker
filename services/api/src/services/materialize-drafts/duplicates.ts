import { and, eq, gte, lte } from "drizzle-orm";
import { transactions } from "@portfolio/db";
import type { ParsedTransaction } from "@portfolio/schema";
import { findCrossSourceDuplicates, classifyMatchBySource } from "../parsers/dedup.js";
import { getStagedDocumentId } from "../../storage/receipts.js";
import { CONFIRMED_TX_STATUSES, isEnrichmentCapable } from "../import-policy.js";
import type { ResolvedDraft } from "./instruments.js";
import type { Ctx, TxSource } from "./types.js";

export type CommittedCandidate = {
  id: string;
  key: string | null;
  action: string;
  quantity: string;
  price: string;
  executedAt: Date;
  source: string | null;
};

export type DuplicateClassification = {
  enrichmentMatches: Array<{ draftIndex: number; matchedTransactionId: string }>;
  enrichmentDraftIndices: Set<number>;
  plainDuplicates: Array<{ draftIndex: number; matched: CommittedCandidate }>;
  /**
   * Drafts that economically match a **pending** (unconfirmed) transaction row.
   *
   * A pending row is invisible to every derivation, so it must not be treated as "already
   * imported" — but it also must not be auto-enriched: enrichment would fold the incoming
   * data into a row the user may still discard, silently swallowing the import. These block
   * with a 409 and are resolved per row by the user.
   */
  pendingDuplicates: Array<{ draftIndex: number; matched: CommittedCandidate }>;
};

export function sourceTypeForDraft(d: ParsedTransaction, source: TxSource) {
  const hasTaxComponents = d.taxComponents && Object.keys(d.taxComponents).length > 0;
  return (
    hasTaxComponents
      ? "pdf"
      : source === "pytr"
        ? "pytr"
        : source === "ibkr"
          ? "ibkr"
          : source === "manual"
            ? "manual"
            : source === "screenshot"
              ? "screenshot"
              : source === "pdf"
                ? "pdf"
                : "csv"
  ) as "pdf" | "pytr" | "ibkr" | "screenshot" | "csv" | "manual";
}

export async function classifyDraftDuplicates(
  ctx: Ctx,
  args: {
    resolved: ResolvedDraft[];
    targetPortfolioId: string;
    source: TxSource;
    importId: string;
  },
): Promise<DuplicateClassification> {
  const { resolved, targetPortfolioId, source, importId } = args;
  const enrichmentMatches: Array<{ draftIndex: number; matchedTransactionId: string }> = [];
  const enrichmentDraftIndices = new Set<number>();
  const plainDuplicates: Array<{ draftIndex: number; matched: CommittedCandidate }> = [];
  const pendingDuplicates: Array<{ draftIndex: number; matched: CommittedCandidate }> = [];

  // Bound the candidate set by the drafts' date range. The fingerprint matches within a
  // ±1 day window (trade date vs settlement date), so a margin of one day on each side
  // covers every row that could possibly match — and the query rides the existing
  // (portfolioId, executedAt) index instead of scanning the whole portfolio.
  const dayMs = 24 * 60 * 60 * 1000;
  const draftTimes = resolved
    .map(({ draft }) => new Date(draft.executedAt).getTime())
    .filter((t) => Number.isFinite(t));
  const rows = await ctx.db
    .select({
      id: transactions.id,
      instrumentId: transactions.instrumentId,
      type: transactions.type,
      executedAt: transactions.executedAt,
      quantity: transactions.quantity,
      price: transactions.price,
      source: transactions.source,
      externalId: transactions.externalId,
      status: transactions.status,
    })
    .from(transactions)
    .where(
      draftTimes.length === 0
        ? eq(transactions.portfolioId, targetPortfolioId)
        : and(
            eq(transactions.portfolioId, targetPortfolioId),
            gte(transactions.executedAt, new Date(Math.min(...draftTimes) - dayMs)),
            lte(transactions.executedAt, new Date(Math.max(...draftTimes) + dayMs)),
          ),
    );

  // Only rows a derivation actually counts may act as "already imported". `draft` rows are
  // unconfirmed and `archived` rows are deliberately excluded — neither may block or absorb
  // an import, because neither is visible to holdings, cash, contributions or tax.
  const confirmedRows = rows.filter((r) =>
    (CONFIRMED_TX_STATUSES as readonly string[]).includes(r.status),
  );
  const pendingRows = rows.filter((r) => r.status === "draft");

  const committedExtKeys = new Set(
    confirmedRows.filter((r) => r.externalId).map((r) => `${r.source}|${r.externalId}`),
  );

  const toCandidate = (r: (typeof rows)[number]): CommittedCandidate => ({
    id: r.id,
    key: r.instrumentId,
    action: r.type,
    quantity: r.quantity,
    price: r.price,
    executedAt: r.executedAt,
    source: r.source,
  });
  const committedCandidates: CommittedCandidate[] = confirmedRows.map(toCandidate);
  const pendingCandidates: CommittedCandidate[] = pendingRows.map(toCandidate);
  const draftCandidates = resolved.map(({ draft: d, instrumentId }) => ({
    key: instrumentId,
    action: d.action,
    quantity: d.quantity,
    price: d.price,
    executedAt: d.executedAt,
  }));

  const allMatches = findCrossSourceDuplicates(draftCandidates, committedCandidates).filter(
    ({ draftIndex }) => {
      const d = resolved[draftIndex].draft;
      const prospectiveExtId = d.externalId ?? `import:${importId}:${draftIndex}`;
      return !committedExtKeys.has(`${source}|${prospectiveExtId}`);
    },
  );

  // A pending row is matched separately: it never becomes an enrichment target, so the
  // drafts it claims are pulled out of the committed match set first.
  const pendingMatches = findCrossSourceDuplicates(draftCandidates, pendingCandidates);
  const pendingDraftIndices = new Set(pendingMatches.map((m) => m.draftIndex));

  if (allMatches.length === 0 && pendingMatches.length === 0) {
    return {
      enrichmentMatches,
      enrichmentDraftIndices,
      plainDuplicates,
      pendingDuplicates,
    };
  }

  // Enrichment-capability: the *factual* document check. The upload-time annotation
  // predicts the same thing from the parser kind (import-policy.ts) — the two agree for
  // every import kind that stores a document, and the upload-time side is deliberately
  // the permissive one so a row is never filtered out of the import and silently lost.
  const hasStagedDoc = !!(await getStagedDocumentId(ctx, importId));

  for (const match of allMatches) {
    if (pendingDraftIndices.has(match.draftIndex)) continue;
    const d = resolved[match.draftIndex].draft;
    const hasTaxComponents = d.taxComponents && Object.keys(d.taxComponents).length > 0;
    const draftHasEnrichment = isEnrichmentCapable({
      hasStagedDocument: hasStagedDoc,
      hasTaxComponents: !!hasTaxComponents,
    });
    // `source` is already a `transactions.source` value — compare it as one. Passing a
    // parser tag here would double-convert ("pdf" → "screenshot") and mis-classify every
    // PDF import (see classifyMatchBySource).
    const kind = classifyMatchBySource(source, match.matched.source ?? "csv", draftHasEnrichment);
    if (kind === "enrichment") {
      enrichmentMatches.push({
        draftIndex: match.draftIndex,
        matchedTransactionId: match.matched.id,
      });
      enrichmentDraftIndices.add(match.draftIndex);
    } else {
      plainDuplicates.push({ draftIndex: match.draftIndex, matched: match.matched });
    }
  }

  for (const match of pendingMatches) {
    pendingDuplicates.push({ draftIndex: match.draftIndex, matched: match.matched });
  }

  return {
    enrichmentMatches,
    enrichmentDraftIndices,
    plainDuplicates,
    pendingDuplicates,
  };
}

import { eq } from "drizzle-orm";
import { transactions } from "@portfolio/db";
import type { ParsedTransaction } from "@portfolio/schema";
import { findCrossSourceDuplicates, classifyMatch } from "../parsers/dedup.js";
import { getStagedDocumentId } from "../../storage/receipts.js";
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

  const committed = await ctx.db
    .select({
      id: transactions.id,
      instrumentId: transactions.instrumentId,
      type: transactions.type,
      executedAt: transactions.executedAt,
      quantity: transactions.quantity,
      price: transactions.price,
      source: transactions.source,
      externalId: transactions.externalId,
    })
    .from(transactions)
    .where(eq(transactions.portfolioId, targetPortfolioId));

  const committedExtKeys = new Set(
    committed.filter((r) => r.externalId).map((r) => `${r.source}|${r.externalId}`),
  );

  const committedCandidates: CommittedCandidate[] = committed.map((r) => ({
    id: r.id,
    key: r.instrumentId,
    action: r.type,
    quantity: r.quantity,
    price: r.price,
    executedAt: r.executedAt,
    source: r.source,
  }));
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
  if (allMatches.length === 0) {
    return { enrichmentMatches, enrichmentDraftIndices, plainDuplicates };
  }

  const hasStagedDoc = !!(await getStagedDocumentId(ctx, importId));
  for (const match of allMatches) {
    const d = resolved[match.draftIndex].draft;
    const hasTaxComponents = d.taxComponents && Object.keys(d.taxComponents).length > 0;
    const draftHasEnrichment = hasStagedDoc || !!hasTaxComponents;
    const kind = classifyMatch(source, match.matched.source ?? "csv", draftHasEnrichment);
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
  return { enrichmentMatches, enrichmentDraftIndices, plainDuplicates };
}

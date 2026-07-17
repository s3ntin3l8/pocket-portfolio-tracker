import { transactions, transactionSources } from "@portfolio/db";
import type { ParsedTransaction } from "@portfolio/schema";
import { enrichTransactionFromDrafts } from "../enrichment.js";
import type { ResolvedDraft } from "./instruments.js";
import { resolveDraftInstruments } from "./instruments.js";
import { classifyDraftDuplicates, sourceTypeForDraft } from "./duplicates.js";
import type { Ctx, DbOrTx, TxRow, TxSource, TxStatus } from "./types.js";

export async function writeResolvedDrafts(
  db: DbOrTx,
  args: {
    resolved: ResolvedDraft[];
    skipDraftIndices: Set<number>;
    targetPortfolioId: string;
    source: TxSource;
    importId: string;
    status: TxStatus;
  },
): Promise<{ written: TxRow[]; attempted: number; skipped: number }> {
  const { resolved, skipDraftIndices, targetPortfolioId, source, importId, status } = args;
  const written: TxRow[] = [];
  let attempted = 0;
  let skipped = 0;

  for (let i = 0; i < resolved.length; i++) {
    if (skipDraftIndices.has(i)) continue;

    const { draft: d, instrumentId } = resolved[i];
    attempted++;
    const externalId = d.externalId ?? `import:${importId}:${i}`;
    const [row] = await db
      .insert(transactions)
      .values({
        portfolioId: targetPortfolioId,
        instrumentId,
        type: d.action,
        quantity: d.quantity,
        price: d.price,
        fees: d.fees,
        tax: d.tax ?? null,
        executedPrice: d.executedPrice ?? null,
        fxRate: d.fxRate ?? null,
        venue: d.venue ?? null,
        documentRefs: d.documentRefs ?? null,
        kind: d.kind ?? null,
        description: d.description ?? null,
        vorabBase: d.vorabBase ?? null,
        perShare: d.perShare ?? null,
        shares: d.shares ?? null,
        nativeCurrency: d.nativeCurrency ?? null,
        grossNative: d.grossNative ?? null,
        currency: d.currency,
        executedAt: d.executedAt,
        source,
        status,
        importId,
        externalId,
        savingsPlanId: d.savingsPlanId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      written.push(row);
      await db
        .insert(transactionSources)
        .values({
          transactionId: row.id,
          sourceType: sourceTypeForDraft(d, source),
          importId,
          externalId: d.externalId ?? null,
          orderRef: d.orderRef ?? null,
          tax: d.tax ?? null,
          fees: d.fees ?? null,
          executedPrice: d.executedPrice ?? null,
          fxRate: d.fxRate ?? null,
          venue: d.venue ?? null,
          vorabBase: d.vorabBase ?? null,
          perShare: d.perShare ?? null,
          shares: d.shares ?? null,
          nativeCurrency: d.nativeCurrency ?? null,
          grossNative: d.grossNative ?? null,
          taxComponents: d.taxComponents ? (d.taxComponents as Record<string, unknown>) : null,
          confidence: String(d.confidence),
        })
        .onConflictDoNothing();
      for (const extra of d.extraSources ?? []) {
        await db
          .insert(transactionSources)
          .values({
            transactionId: row.id,
            sourceType: sourceTypeForDraft(d, source),
            importId,
            externalId: extra.externalId,
            confidence: String(d.confidence),
            rawData: (extra.raw ?? null) as Record<string, unknown> | null,
          })
          .onConflictDoNothing();
      }
    } else {
      skipped++;
    }
  }
  return { written, attempted, skipped };
}

export async function materializeDrafts(
  ctx: Ctx,
  args: {
    drafts: ParsedTransaction[];
    targetPortfolioId: string;
    source: TxSource;
    importId: string;
    status: TxStatus;
    isEu: boolean;
  },
): Promise<{
  written: TxRow[];
  attempted: number;
  skipped: number;
  enriched: number;
  collapsed: string[];
  matchedTransactionIds: string[];
}> {
  const { drafts, targetPortfolioId, source, importId, status, isEu } = args;
  if (drafts.length === 0)
    return {
      written: [],
      attempted: 0,
      skipped: 0,
      enriched: 0,
      collapsed: [],
      matchedTransactionIds: [],
    };

  const resolved = await resolveDraftInstruments(ctx, drafts, { isEu });
  const { enrichmentMatches, plainDuplicates } = await classifyDraftDuplicates(ctx, {
    resolved,
    targetPortfolioId,
    source,
    importId,
  });

  const allMatches = [
    ...enrichmentMatches,
    ...plainDuplicates.map((p) => ({
      draftIndex: p.draftIndex,
      matchedTransactionId: p.matched.id,
    })),
  ];
  const skipDraftIndices = new Set(allMatches.map((m) => m.draftIndex));

  const { written, attempted, skipped } = await ctx.db.transaction((tx) =>
    writeResolvedDrafts(tx, {
      resolved,
      skipDraftIndices,
      targetPortfolioId,
      source,
      importId,
      status,
    }),
  );

  let enriched = 0;
  const collapsed: string[] = [];
  const matchedTransactionIds = new Set<string>();
  for (const { draftIndex, matchedTransactionId } of allMatches) {
    const draft = resolved[draftIndex].draft;
    try {
      await enrichTransactionFromDrafts(matchedTransactionId, ctx.db, [draft], {
        importId,
        importSource: source,
      });
      enriched++;
      matchedTransactionIds.add(matchedTransactionId);
    } catch (err) {
      ctx.log?.warn(
        { err, matchedTransactionId },
        "materializeDrafts: enrichment failed (non-fatal)",
      );
    }
    if (draft.externalId) collapsed.push(draft.externalId);
  }

  return {
    written,
    attempted,
    skipped,
    enriched,
    collapsed,
    matchedTransactionIds: [...matchedTransactionIds],
  };
}

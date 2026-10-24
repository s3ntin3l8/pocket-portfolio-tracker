import { portfolios, transactions, transactionSources } from "@portfolio/db";
import { sql } from "drizzle-orm";
import type { ParsedTransaction } from "@portfolio/schema";
import { enrichTransactionFromDrafts } from "../enrichment.js";
import type { ResolvedDraft } from "./instruments.js";
import { resolveDraftInstruments } from "./instruments.js";
import { classifyDraftDuplicates, sourceTypeForDraft } from "./duplicates.js";
import { decideDuplicates, type DuplicateMatch, type DuplicateResolution } from "./resolutions.js";
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

export type MaterializeResult =
  | {
      kind: "duplicate";
      plainDuplicates: DuplicateMatch[];
      pendingDuplicates: DuplicateMatch[];
    }
  | {
      kind: "ok";
      written: TxRow[];
      attempted: number;
      skipped: number;
      enriched: number;
      collapsed: string[];
      matchedTransactionIds: string[];
    };

/**
 * Materialize parsed drafts as transaction rows.
 *
 * Classification and writing happen in **one** transaction behind a row lock on the
 * portfolio row, so a sync running concurrently with a manual import confirm of the same
 * trade cannot write the trade twice (the `(portfolioId, source, externalId)` unique index
 * cannot help across sources). The confirm path takes the same lock (see
 * `routes/imports/confirm.ts`), which is what serialises the two.
 *
 * The enrichment of a matched row happens inside the same transaction as the write: a
 * failed enrichment must not leave a draft "skipped and not enriched". A failure is
 * caught and the event is *not* collapsed, so the next sync re-stages it.
 */
export async function materializeDrafts(
  ctx: Ctx,
  args: {
    drafts: ParsedTransaction[];
    targetPortfolioId: string;
    source: TxSource;
    importId: string;
    status: TxStatus;
    isEu: boolean;
    /** See `resolveDraftInstruments`: ISIN-bearing drafts take the EU path (AI-assisted entry). */
    euWhenIsin?: boolean;
    /**
     * Who is asking. A user-facing import blocks on a duplicate until the user decides;
     * a broker sync has no review screen, so a cross-source match is merged into the
     * confirmed row it matches (see `decideDuplicates`).
     */
    mode?: "user" | "sync";
    /** Per-draft dispositions for the duplicates the caller reports back. */
    resolutions?: DuplicateResolution[];
    /** Blanket acknowledgement of plain duplicates (historical behaviour). */
    acknowledgeDuplicates?: boolean;
  },
): Promise<MaterializeResult> {
  const {
    drafts,
    targetPortfolioId,
    source,
    importId,
    status,
    isEu,
    euWhenIsin,
    mode,
    resolutions,
    acknowledgeDuplicates,
  } = args;
  if (drafts.length === 0) {
    return {
      kind: "ok",
      written: [],
      attempted: 0,
      skipped: 0,
      enriched: 0,
      collapsed: [],
      matchedTransactionIds: [],
    };
  }

  // Instrument resolution may hit the network — it stays OUTSIDE the transaction so a slow
  // provider lookup never holds the portfolio lock.
  const resolved = await resolveDraftInstruments(ctx, drafts, { isEu, euWhenIsin });

  return ctx.db.transaction(async (tx) => {
    // Row-level lock on the portfolio — the same lock the confirm path takes. It
    // serialises a sync against a concurrent confirm of the same portfolio.
    await tx.execute(
      sql`SELECT 1 FROM ${portfolios} WHERE ${portfolios.id} = ${targetPortfolioId} FOR UPDATE`,
    );

    const classification = await classifyDraftDuplicates(
      { db: tx, log: ctx.log },
      {
        resolved,
        targetPortfolioId,
        source,
        importId,
      },
    );

    const decisions = decideDuplicates({
      enrichmentMatches: classification.enrichmentMatches,
      plainDuplicates: classification.plainDuplicates,
      pendingDuplicates: classification.pendingDuplicates,
      resolutions,
      acknowledgeDuplicates,
      mode,
    });

    if (decisions.blockedPlain.length > 0 || decisions.blockedPending.length > 0) {
      return {
        kind: "duplicate",
        plainDuplicates: decisions.blockedPlain,
        pendingDuplicates: decisions.blockedPending,
      };
    }

    const skipDraftIndices = new Set<number>([
      ...decisions.enrichmentMatches.map((m) => m.draftIndex),
      ...decisions.skippedIndices,
    ]);

    const { written, attempted, skipped } = await writeResolvedDrafts(tx, {
      resolved,
      skipDraftIndices,
      targetPortfolioId,
      source,
      importId,
      status,
    });

    // Enrichment runs inside the write transaction: the matched row is updated with the
    // incoming document's tax/fees atomically with the rest of the import.
    let enriched = 0;
    const collapsed: string[] = [];
    const matchedTransactionIds: string[] = [];
    for (const { draftIndex, matchedTransactionId } of decisions.enrichmentMatches) {
      const draft = resolved[draftIndex].draft;
      try {
        await enrichTransactionFromDrafts(matchedTransactionId, tx, [draft], {
          importId,
          importSource: source,
        });
        enriched++;
        if (!matchedTransactionIds.includes(matchedTransactionId)) {
          matchedTransactionIds.push(matchedTransactionId);
        }
        // Only a *successful* enrichment collapses the event. A failed one leaves it
        // unresolved so the next sync re-stages it instead of losing it silently.
        if (draft.externalId) collapsed.push(draft.externalId);
      } catch (err) {
        ctx.log?.warn(
          { err, matchedTransactionId },
          "materializeDrafts: enrichment failed — the event stays unresolved",
        );
      }
    }

    return {
      kind: "ok",
      written,
      attempted,
      skipped,
      enriched,
      collapsed,
      matchedTransactionIds,
    };
  });
}

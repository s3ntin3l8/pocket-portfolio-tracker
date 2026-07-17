import { toDateKey } from "@portfolio/core";
import { and, eq, inArray } from "drizzle-orm";
import { transactions, transactionSources, documents, trResolvedEvents } from "@portfolio/db";
import type { DB } from "../../db/client.js";
import { actionClass, recomputeRollup, type SourceRow } from "../parsers/dedup.js";
import { MergeBlockedError, type MergeResult } from "./types.js";

type TxRow = typeof transactions.$inferSelect;

async function loadRow(db: DB, portfolioId: string, id: string): Promise<TxRow | null> {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.portfolioId, portfolioId), eq(transactions.id, id)));
  return row ?? null;
}

function assertMergeable(survivor: TxRow, absorbed: TxRow): void {
  if (survivor.id === absorbed.id) throw new MergeBlockedError("same_transaction");
  if (survivor.instrumentId !== absorbed.instrumentId) {
    throw new MergeBlockedError("different_instrument");
  }
  if (actionClass(survivor.type) !== actionClass(absorbed.type)) {
    throw new MergeBlockedError("incompatible_type");
  }
  if (survivor.loanId || absorbed.loanId) {
    throw new MergeBlockedError("loan_linked");
  }
}

function ownScalarsAsSourceRow(row: TxRow): SourceRow {
  return {
    sourceType: row.source,
    tax: row.tax,
    fees: row.fees,
    executedPrice: row.executedPrice,
    fxRate: row.fxRate,
    venue: row.venue,
    perShare: row.perShare,
    shares: row.shares,
    nativeCurrency: row.nativeCurrency,
    grossNative: row.grossNative,
    vorabBase: row.vorabBase,
    taxComponents: null,
  };
}

async function ensureSourceRow(db: DB, row: TxRow): Promise<void> {
  const existing = await db
    .select({ id: transactionSources.id })
    .from(transactionSources)
    .where(eq(transactionSources.transactionId, row.id))
    .limit(1);
  if (existing.length > 0) return;

  await db
    .insert(transactionSources)
    .values({
      transactionId: row.id,
      sourceType: row.source,
      importId: row.importId ?? null,
      documentId: null,
      externalId: row.externalId ?? null,
      orderRef: null,
      tax: row.tax,
      fees: row.fees,
      executedPrice: row.executedPrice,
      fxRate: row.fxRate,
      venue: row.venue,
      perShare: row.perShare,
      shares: row.shares,
      nativeCurrency: row.nativeCurrency,
      grossNative: row.grossNative,
      vorabBase: row.vorabBase,
      taxComponents: null,
      confidence: null,
      rawData: null,
    })
    .onConflictDoNothing();
}

export async function mergeTransactions(
  db: DB,
  args: { portfolioId: string; survivorId: string; absorbedId: string },
): Promise<MergeResult> {
  const { portfolioId, survivorId, absorbedId } = args;

  return db.transaction(async (tx) => {
    const survivor = await loadRow(tx, portfolioId, survivorId);
    const absorbed = await loadRow(tx, portfolioId, absorbedId);
    if (!survivor || !absorbed) throw new MergeBlockedError("not_found");
    assertMergeable(survivor, absorbed);

    await ensureSourceRow(tx, survivor);
    await ensureSourceRow(tx, absorbed);

    const survivorSources = await tx
      .select({
        sourceType: transactionSources.sourceType,
        externalId: transactionSources.externalId,
      })
      .from(transactionSources)
      .where(eq(transactionSources.transactionId, survivorId));
    const survivorKeys = new Set(
      survivorSources
        .filter((r) => r.externalId != null)
        .map((r) => `${r.sourceType}|${r.externalId}`),
    );
    const absorbedSources = await tx
      .select({
        id: transactionSources.id,
        sourceType: transactionSources.sourceType,
        externalId: transactionSources.externalId,
      })
      .from(transactionSources)
      .where(eq(transactionSources.transactionId, absorbedId));

    const colliding = absorbedSources.filter(
      (r) => r.externalId != null && survivorKeys.has(`${r.sourceType}|${r.externalId}`),
    );
    const reparentable = absorbedSources.filter((r) => !colliding.includes(r));

    if (colliding.length > 0) {
      await tx.delete(transactionSources).where(
        inArray(
          transactionSources.id,
          colliding.map((r) => r.id),
        ),
      );
    }
    if (reparentable.length > 0) {
      await tx
        .update(transactionSources)
        .set({ transactionId: survivorId })
        .where(
          inArray(
            transactionSources.id,
            reparentable.map((r) => r.id),
          ),
        );
    }

    await tx
      .update(documents)
      .set({ transactionId: survivorId })
      .where(eq(documents.transactionId, absorbedId));

    const survivorRefs = ((survivor.documentRefs as { id?: string }[] | null) ?? []).slice();
    const absorbedRefs = (absorbed.documentRefs as { id?: string }[] | null) ?? [];
    const seenRefIds = new Set(survivorRefs.map((r) => r.id).filter(Boolean));
    for (const ref of absorbedRefs) {
      if (ref.id && seenRefIds.has(ref.id)) continue;
      survivorRefs.push(ref);
      if (ref.id) seenRefIds.add(ref.id);
    }

    const allSourceRows = await tx
      .select({
        sourceType: transactionSources.sourceType,
        tax: transactionSources.tax,
        fees: transactionSources.fees,
        executedPrice: transactionSources.executedPrice,
        fxRate: transactionSources.fxRate,
        venue: transactionSources.venue,
        perShare: transactionSources.perShare,
        shares: transactionSources.shares,
        nativeCurrency: transactionSources.nativeCurrency,
        grossNative: transactionSources.grossNative,
        vorabBase: transactionSources.vorabBase,
        taxComponents: transactionSources.taxComponents,
      })
      .from(transactionSources)
      .where(eq(transactionSources.transactionId, survivorId));
    const rollup = recomputeRollup(allSourceRows as SourceRow[]);

    const patch: Partial<TxRow> = {
      documentRefs: survivorRefs.length > 0 ? survivorRefs : null,
    };
    if (!rollup.hasManual) {
      if (rollup.tax !== null) patch.tax = rollup.tax;
      if (rollup.fees !== null) patch.fees = rollup.fees;
      if (rollup.executedPrice !== null) patch.executedPrice = rollup.executedPrice;
      if (rollup.fxRate !== null) patch.fxRate = rollup.fxRate;
      if (rollup.venue !== null) patch.venue = rollup.venue;
      if (rollup.perShare !== null) patch.perShare = rollup.perShare;
      if (rollup.shares !== null) patch.shares = rollup.shares;
      if (rollup.nativeCurrency !== null) patch.nativeCurrency = rollup.nativeCurrency;
      if (rollup.grossNative !== null) patch.grossNative = rollup.grossNative;
      if (rollup.vorabBase !== null) patch.vorabBase = rollup.vorabBase;
    }
    await tx.update(transactions).set(patch).where(eq(transactions.id, survivorId));

    if ((absorbed.source === "pytr" || absorbed.source === "ibkr") && absorbed.externalId) {
      await tx
        .insert(trResolvedEvents)
        .values({
          portfolioId,
          source: absorbed.source,
          eventId: absorbed.externalId,
          resolution: "confirmed",
        })
        .onConflictDoNothing();
    }

    await tx.delete(transactions).where(eq(transactions.id, absorbedId));

    const days = new Set([toDateKey(survivor.executedAt), toDateKey(absorbed.executedAt)]);
    return {
      survivorId,
      recompute: [...days].map((day) => ({ portfolioId, day })),
    };
  });
}

export { loadRow, assertMergeable, ownScalarsAsSourceRow };

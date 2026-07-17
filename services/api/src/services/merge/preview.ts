import { eq, inArray } from "drizzle-orm";
import { transactionSources, documents } from "@portfolio/db";
import type { DB } from "../../db/client.js";
import { recomputeRollup, type SourceRow } from "../parsers/dedup.js";
import { MergeBlockedError, type MergePreview } from "./types.js";
import { loadRow, assertMergeable, ownScalarsAsSourceRow } from "./core.js";

export async function previewMerge(
  db: DB,
  args: { portfolioId: string; survivorId: string; absorbedId: string },
): Promise<MergePreview> {
  const { portfolioId, survivorId, absorbedId } = args;
  const survivor = await loadRow(db, portfolioId, survivorId);
  const absorbed = await loadRow(db, portfolioId, absorbedId);
  if (!survivor || !absorbed) return { ok: false, blockedReason: "not_found" };

  try {
    assertMergeable(survivor, absorbed);
  } catch (err) {
    if (err instanceof MergeBlockedError) return { ok: false, blockedReason: err.reason };
    throw err;
  }

  const [survivorSources, absorbedSources, docCount] = await Promise.all([
    db
      .select({
        sourceType: transactionSources.sourceType,
        externalId: transactionSources.externalId,
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
      .where(eq(transactionSources.transactionId, survivorId)),
    db
      .select({
        sourceType: transactionSources.sourceType,
        externalId: transactionSources.externalId,
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
      .where(eq(transactionSources.transactionId, absorbedId)),
    db
      .select({ id: documents.id })
      .from(documents)
      .where(inArray(documents.transactionId, [survivorId, absorbedId])),
  ]);

  const survivorRows: SourceRow[] =
    survivorSources.length > 0
      ? (survivorSources as SourceRow[])
      : [ownScalarsAsSourceRow(survivor)];
  const absorbedRowsRaw: SourceRow[] =
    absorbedSources.length > 0
      ? (absorbedSources as SourceRow[])
      : [ownScalarsAsSourceRow(absorbed)];

  const survivorKeys = new Set(
    survivorRows
      .filter((r) => (r as { externalId?: string }).externalId != null)
      .map((r) => `${r.sourceType}|${(r as { externalId?: string }).externalId}`),
  );
  const absorbedRows = absorbedRowsRaw.filter((r) => {
    const key = (r as { externalId?: string }).externalId;
    return !(key != null && survivorKeys.has(`${r.sourceType}|${key}`));
  });

  const rollup = recomputeRollup([...survivorRows, ...absorbedRows]);

  return {
    ok: true,
    merged: {
      quantity: survivor.quantity,
      price: survivor.price,
      executedAt: survivor.executedAt.toISOString(),
      type: survivor.type,
      currency: survivor.currency,
      tax: rollup.hasManual ? survivor.tax : rollup.tax,
      fees: rollup.hasManual ? survivor.fees : rollup.fees,
      executedPrice: rollup.hasManual ? survivor.executedPrice : rollup.executedPrice,
      fxRate: rollup.hasManual ? survivor.fxRate : rollup.fxRate,
      venue: rollup.hasManual ? survivor.venue : rollup.venue,
      perShare: rollup.hasManual ? survivor.perShare : rollup.perShare,
      shares: rollup.hasManual ? survivor.shares : rollup.shares,
      nativeCurrency: rollup.hasManual ? survivor.nativeCurrency : rollup.nativeCurrency,
      grossNative: rollup.hasManual ? survivor.grossNative : rollup.grossNative,
      vorabBase: rollup.hasManual ? survivor.vorabBase : rollup.vorabBase,
      documentCount: docCount.length,
    },
  };
}

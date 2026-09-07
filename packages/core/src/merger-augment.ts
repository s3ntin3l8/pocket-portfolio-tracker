/// <reference types="node" />
import { D } from "./decimal.js";
import { toDateKey } from "./date-utils.js";
import { buildShareTimelines, sharesHeldAt } from "./holdings.js";
import type { CoreTransaction, CorporateAction } from "./types.js";

/**
 * For each merger CA with `taxableMarketValue` set, ensure the sell+buy pair exists in
 * the transactions. If the importer forgot to write the pair (or any external source
 * emits only the corporate_actions row), synthesize it so the engine produces the same
 * tax-correct result as a pre-priced pair would.
 *
 * Pre-priced pair identification:
 *   - kind:"merger" on BOTH the sell (on `ca.instrumentId`) and the buy (on `ca.targetInstrumentId`)
 *   - same executedAt day as the CA's exDate
 *
 * Synthesis math (taxable merger only — `taxableMarketValue` is the only signal we have):
 *   outQty = shares of ca.instrumentId held at exDate (from `buildShareTimelines`)
 *   inQty  = outQty * ratioTo
 *   sell leg: price = taxableMarketValue / outQty  (proceeds = MV)
 *   buy  leg: price = taxableMarketValue / inQty   (basis = MV, stepped up to market)
 *
 * If the held quantity is 0 (no shares to merge), bail silently — there's no tax event.
 * If a pair IS already present, validate the sell leg's proceeds against MV (defense
 * in depth) but don't fail — the importer's data wins. Pair presence + mismatch emits
 * a structured stderr warning so downstream log shippers can flag the discrepancy
 * without breaking the run. We use process.stderr.write instead of console.warn because
 * the core tsconfig lib is ES2024 only (no DOM lib), so the `console` global is
 * unavailable here.
 *
 * Tax-neutral mergers (taxableMarketValue null/undefined) are intentionally NOT
 * synthesized — we have no price signal, so we can't price either leg.
 */
export function augmentTransactionsWithSyntheticMergerLegs(
  txns: CoreTransaction[],
  cas: CorporateAction[],
): CoreTransaction[] {
  const mergerCas = cas.filter(
    (ca) =>
      ca.type === "merger" &&
      ca.taxableMarketValue != null &&
      ca.targetInstrumentId != null &&
      ca.ratioTo != null,
  );
  if (mergerCas.length === 0) return txns;

  const augmented: CoreTransaction[] = [...txns];
  const timelines = buildShareTimelines(augmented, cas);

  for (const ca of mergerCas) {
    const taxableMarketValue = D(ca.taxableMarketValue!);
    const targetId = ca.targetInstrumentId!;
    const ratioTo = D(ca.ratioTo!);
    const exKey = toDateKey(ca.exDate);

    const sellPair = augmented.find(
      (t) =>
        t.instrumentId === ca.instrumentId &&
        t.type === "sell" &&
        t.kind === "merger" &&
        toDateKey(t.executedAt) === exKey,
    );
    const buyPair = augmented.find(
      (t) =>
        t.instrumentId === targetId &&
        t.type === "buy" &&
        t.kind === "merger" &&
        toDateKey(t.executedAt) === exKey,
    );

    // Defense in depth: a pre-priced pair's sell leg should sum to taxableMarketValue.
    // We intentionally don't fail on mismatch — that's the importer's data and the user
    // sees the same value either way. Emit a structured stderr line so downstream
    // observability can flag mismatches without breaking the run.
    if (sellPair) {
      const pairProceeds = D(sellPair.quantity).mul(D(sellPair.price));
      if (!pairProceeds.eq(taxableMarketValue)) {
        process.stderr.write(
          JSON.stringify({
            level: "warn",
            event: "merger_importer_proceeds_mismatch",
            caId: `${ca.instrumentId}@${ca.exDate.toISOString()}`,
            expected: taxableMarketValue.toString(),
            got: pairProceeds.toString(),
          }) + "\n",
        );
      }
    }

    if (sellPair && buyPair) continue;

    const heldQty = sharesHeldAt(timelines, ca.instrumentId, ca.exDate);
    if (!heldQty || heldQty.lte(0)) continue;

    // Currency reference — use whatever currency existing transactions for this
    // instrument already use. The merger route enforces same-currency across both
    // instruments, so the from currency is also valid for the target.
    const fromCcy =
      augmented.find((t) => t.instrumentId === ca.instrumentId)?.currency ?? sellPair?.currency;
    const toCcy =
      augmented.find((t) => t.instrumentId === targetId)?.currency ?? buyPair?.currency ?? fromCcy;
    if (!fromCcy || !toCcy) continue;

    const outQty = heldQty;
    const inQty = heldQty.mul(ratioTo);

    if (!sellPair) {
      augmented.push({
        instrumentId: ca.instrumentId,
        type: "sell",
        quantity: outQty.toString(),
        price: taxableMarketValue.div(outQty).toString(),
        fees: "0",
        currency: fromCcy,
        executedAt: ca.exDate,
        kind: "merger",
        status: "normal",
      });
    }
    if (!buyPair) {
      augmented.push({
        instrumentId: targetId,
        type: "buy",
        quantity: inQty.toString(),
        price: taxableMarketValue.div(inQty).toString(),
        fees: "0",
        currency: toCcy,
        executedAt: ca.exDate,
        kind: "merger",
        status: "normal",
      });
    }
  }

  return augmented;
}

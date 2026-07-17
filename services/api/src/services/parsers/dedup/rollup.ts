import type { TaxComponents } from "@portfolio/schema";
import { SOURCE_RANK } from "./constants.js";

/**
 * Sum decimal strings exactly via scaled-integer (BigInt) arithmetic — unlike `sumField`'s
 * cents-rounding (fine for EUR tax/fees), this preserves full precision for values like an
 * 8-decimal-place per-share rate. Scales to the max fractional-digit count seen across the
 * inputs, adds as integers, then rescales back to a decimal string.
 */
function sumDecimalExact(values: string[]): string {
  let maxScale = 0;
  for (const v of values) {
    const dot = v.indexOf(".");
    if (dot >= 0) maxScale = Math.max(maxScale, v.length - dot - 1);
  }
  const factor = 10n ** BigInt(maxScale);
  let total = 0n;
  for (const raw of values) {
    const v = raw.trim();
    const neg = v.startsWith("-");
    const unsigned = neg ? v.slice(1) : v;
    const [intPart, fracPart = ""] = unsigned.split(".");
    const fracScaled = (fracPart + "0".repeat(maxScale)).slice(0, maxScale);
    const scaled =
      BigInt(intPart || "0") * factor + (maxScale > 0 ? BigInt(fracScaled || "0") : 0n);
    total += neg ? -scaled : scaled;
  }
  const sign = total < 0n ? "-" : "";
  const abs = total < 0n ? -total : total;
  const s = abs.toString().padStart(maxScale + 1, "0");
  const intStr = s.slice(0, s.length - maxScale) || "0";
  const fracStr = maxScale > 0 ? `.${s.slice(s.length - maxScale)}` : "";
  return `${sign}${intStr}${fracStr}`;
}

/** A source row that can contribute to a rollup (from transaction_sources or a draft). */
export interface SourceRow {
  sourceType: string;
  tax?: string | null;
  fees?: string | null;
  executedPrice?: string | null;
  fxRate?: string | null;
  venue?: string | null;
  taxComponents?: TaxComponents | null;
  // Dividend/coupon per-share display fields (see packages/db schema.ts). `perShare` and
  // `grossNative` are SUMMED like tax/fees — a single payment event can legitimately settle
  // across multiple documents (e.g. a split ordinary/return-of-capital distribution), each
  // covering the same shares; `shares`/`nativeCurrency` stay picked (each document reports the
  // full position / same currency, not a fraction of it — summing would double-count).
  perShare?: string | null;
  shares?: string | null;
  nativeCurrency?: string | null;
  grossNative?: string | null;
  // Vorabpauschale taxable base (see packages/db schema.ts). PICKED, not summed — unlike a
  // dividend split across documents, a Vorabpauschale row has exactly one source (the pytr
  // sync event; there is no settlement PDF to enrich against), so summing would only ever
  // double-count a re-synced/re-enriched row.
  vorabBase?: string | null;
}

/**
 * Derive the gold-standard scalar rollup from a set of source rows.
 *
 * For each field:
 *  - Pick the **highest-rank** source type present that has a non-null value.
 *  - For `tax`, `fees`, `perShare`, `grossNative`: SUM across ALL rows of that winning rank
 *    (so multiple settlement documents for one event — split trade-order legs, or a dividend
 *    split across an ordinary + return-of-capital PDF — all contribute; a crucial correctness
 *    invariant). `perShare`/`grossNative` sum with full decimal precision (`sumDecimalExact`);
 *    `tax`/`fees` sum to cents (EUR amounts).
 *  - For `fxRate`: a grossNative-weighted average across rows of the winning rank (falls back
 *    to the first value when no row carries a positive weight) — summing an FX rate directly
 *    would be meaningless, but a gross-weighted average is the economically correct combined
 *    rate when two documents convert different native amounts.
 *  - For `executedPrice`, `venue`, `shares`, `nativeCurrency`: take the first/only value at the
 *    winning rank (they don't sum — see `SourceRow`'s field comments).
 *
 * Returns null on each field when no source row provides it.
 *
 * **`manual` protection:** if a `manual` source row exists, skip recomputing the
 * transaction's scalars entirely — the user's hand-edited values are authoritative.
 * (The caller checks this and skips the DB write for scalars when a manual row exists.)
 *
 * **No-regression invariant:** at most one row per economic component contributes at a given
 * rank unless a document is genuinely split — verified live against production data with zero
 * counterexamples before this summing was introduced. A normal single-document transaction has
 * exactly one non-null value at its winning rank, so SUM there is a no-op vs. the previous PICK.
 *
 * Idempotent and order-independent: re-running on the same source rows is a fixed point.
 */
export function recomputeRollup(rows: SourceRow[]): {
  tax: string | null;
  fees: string | null;
  executedPrice: string | null;
  fxRate: string | null;
  venue: string | null;
  perShare: string | null;
  shares: string | null;
  nativeCurrency: string | null;
  grossNative: string | null;
  vorabBase: string | null;
  hasManual: boolean;
  mergedTaxComponents: TaxComponents;
} {
  const hasManual = rows.some((r) => r.sourceType === "manual");

  type PickableField =
    | "tax"
    | "fees"
    | "executedPrice"
    | "fxRate"
    | "venue"
    | "perShare"
    | "shares"
    | "nativeCurrency"
    | "grossNative"
    | "vorabBase";

  // Find the winning rank for each scalar type.
  function winningRank(field: PickableField): number {
    return rows.reduce((best, r) => {
      const rank = SOURCE_RANK[r.sourceType] ?? 0;
      return r[field] != null && rank > best ? rank : best;
    }, -1);
  }

  function sumField(field: "tax" | "fees", rank: number): string | null {
    if (rank < 0) return null;
    let cents = 0;
    let found = false;
    for (const r of rows) {
      if ((SOURCE_RANK[r.sourceType] ?? 0) === rank && r[field] != null) {
        const n = parseFloat(r[field]!);
        if (Number.isFinite(n)) {
          cents += Math.round(n * 100);
          found = true;
        }
      }
    }
    return found ? (cents / 100).toFixed(2) : null;
  }

  /** Like `sumField`, but preserves full decimal precision (for perShare/grossNative). */
  function sumFieldExact(field: "perShare" | "grossNative", rank: number): string | null {
    if (rank < 0) return null;
    const values: string[] = [];
    for (const r of rows) {
      if ((SOURCE_RANK[r.sourceType] ?? 0) === rank && r[field] != null) values.push(r[field]!);
    }
    return values.length > 0 ? sumDecimalExact(values) : null;
  }

  function pickField(
    field: "executedPrice" | "venue" | "shares" | "nativeCurrency" | "vorabBase",
    rank: number,
  ): string | null {
    if (rank < 0) return null;
    for (const r of rows) {
      if ((SOURCE_RANK[r.sourceType] ?? 0) === rank && r[field] != null) return r[field]!;
    }
    return null;
  }

  /** grossNative-weighted average of fxRate across rows of the winning rank; falls back to the
   *  first fxValue when no row at that rank carries a positive grossNative weight. */
  function fxRateField(rank: number): string | null {
    if (rank < 0) return null;
    let fallback: string | null = null;
    let weightedSum = 0;
    let weightTotal = 0;
    for (const r of rows) {
      if ((SOURCE_RANK[r.sourceType] ?? 0) !== rank || r.fxRate == null) continue;
      if (fallback === null) fallback = r.fxRate;
      const fx = parseFloat(r.fxRate);
      const weight = r.grossNative != null ? parseFloat(r.grossNative) : NaN;
      if (Number.isFinite(fx) && Number.isFinite(weight) && weight > 0) {
        weightedSum += fx * weight;
        weightTotal += weight;
      }
    }
    return weightTotal > 0 ? (weightedSum / weightTotal).toFixed(6) : fallback;
  }

  // Merge taxComponents across all rows (union — later rows clobber earlier for same key).
  const mergedTaxComponents: TaxComponents = {};
  for (const r of rows) {
    if (r.taxComponents) {
      Object.assign(mergedTaxComponents, r.taxComponents);
    }
  }

  return {
    tax: sumField("tax", winningRank("tax")),
    fees: sumField("fees", winningRank("fees")),
    executedPrice: pickField("executedPrice", winningRank("executedPrice")),
    fxRate: fxRateField(winningRank("fxRate")),
    venue: pickField("venue", winningRank("venue")),
    perShare: sumFieldExact("perShare", winningRank("perShare")),
    shares: pickField("shares", winningRank("shares")),
    nativeCurrency: pickField("nativeCurrency", winningRank("nativeCurrency")),
    grossNative: sumFieldExact("grossNative", winningRank("grossNative")),
    vorabBase: pickField("vorabBase", winningRank("vorabBase")),
    hasManual,
    mergedTaxComponents,
  };
}

import { Decimal } from "decimal.js";
import { REL_TOL, ABS_TOL, DAY_MS, ACQUISITION_ACTIONS } from "./constants.js";

/** Collapse interchangeable action labels to a single class for matching. A DKB
 *  Umsatzliste row (`buy`) and the matching Wertpapierabrechnung PDF (`savings_plan`)
 *  describe one acquisition; everything else keys on its own action. */
export function actionClass(action: string): string {
  return ACQUISITION_ACTIONS.has(action) ? "acquire" : action;
}

/**
 * Parse a decimal that may use either an English (`.`) or German (`,`) decimal mark,
 * with optional thousands separators. Returns null when it isn't a finite number.
 *
 * Domain note: DKB Umsatzliste values are German (`74,50600000`); Trade Republic and the
 * PDF parser emit dot-decimals. When both marks are present the *last* one is the decimal
 * point; a lone comma is treated as the decimal mark (the German convention these files use).
 *
 * A lone dot is **ambiguous**: `"74.506"` is 74.506 in an English file and 74 506 in a German
 * one. The German reading is preferred here, because it matches the repo's canonical
 * `parseEuroDecimal` (`services/parsers/dkb.ts`) — a German thousands group is only
 * recognised when the shape is unambiguous (`/^-?\d{1,3}(\.\d{3})+$/`), so `"74.50600000"`
 * (eight decimals, as DKB writes quantities) is never misread as a thousands group.
 *
 * Because the ambiguity is inherent to the input, `decimalsClose` does **not** rely on this
 * single reading: it compares every plausible reading of both sides (see
 * `decimalCandidates`). This keeps a German `"1.674"` comparable with a normalized
 * `"1674"` *and* an English `"74.506"` comparable with `"74,506"`.
 */
export function parseLooseDecimal(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = normalizeDecimalString(String(raw).trim());
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise a loose decimal string to a canonical dot-decimal string, or null when it
 * isn't a number.
 *
 * - Both marks present: the **last** one is the decimal mark, the other is the thousands
 *   separator — so `"1.234,56"` and `"1,234.56"` both normalise to `"1234.56"`.
 * - A lone comma is the German decimal mark: `"74,50600000"` → `"74.50600000"`.
 * - A lone dot is ambiguous. It is read as a thousands group only when the shape is
 *   unambiguous (`/^-?\d{1,3}(\.\d{3})+$/`), so `"1.674"` → `"1674"` while
 *   `"74.50600000"` (eight decimals, as DKB writes quantities) stays `"74.50600000"`.
 */
function normalizeDecimalString(raw: string): string | null {
  let s = raw.replace(/[€\s]/g, "");
  if (!s) return null;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    const decimal = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}

/**
 * Every plausible numeric reading of a loose decimal string.
 *
 * A pure-dot value is locale-ambiguous (`"74.506"` → 74.506 *or* 74506), so both readings
 * are returned and the caller compares them pairwise. Comparing under *all* readings makes
 * the match ambiguous-input-safe in the safe direction: a value that matches under any
 * reading is treated as a match (the import is then blocked for the user to resolve),
 * while a value that matches under none is a genuine mismatch.
 */
export function decimalCandidates(raw: string | null | undefined): number[] {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];

  const out: number[] = [];
  const push = (v: number) => {
    if (Number.isFinite(v) && !out.some((x) => x === v)) out.push(v);
  };

  // Reading 1 — the German-preferred reading (dot = thousands when it groups in threes).
  const german = parseLooseDecimal(s);
  if (german !== null) push(german);

  // Reading 2 — the English reading (dot = decimal mark, always).
  const english = parseEnglishDecimal(s);
  if (english !== null) push(english);

  return out;
}

/** The English reading of a loose decimal: dot = decimal mark, comma = thousands separator. */
function parseEnglishDecimal(raw: string): number | null {
  let s = raw.replace(/[€\s]/g, "");
  if (!s) return null;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    const decimal = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thousands = decimal === "." ? "," : ".";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Two decimal strings equal within tolerance. Falls back to a trimmed string compare
 *  when either side isn't a finite number, so non-numeric values still match exactly.
 *
 *  The comparison runs on `Decimal` (money is never a float) and over every plausible
 *  reading of both sides, so a German `"1.674"` matches a normalized `"1674"` and an
 *  English `"74.506"` matches a German `"74,506"`. */
export function decimalsClose(a: string, b: string): boolean {
  const xs = decimalCandidates(a);
  const ys = decimalCandidates(b);
  if (xs.length === 0 || ys.length === 0) return String(a).trim() === String(b).trim();
  const absTol = new Decimal(ABS_TOL);
  const relTol = new Decimal(REL_TOL);
  for (const x of xs) {
    for (const y of ys) {
      const dx = new Decimal(x);
      const dy = new Decimal(y);
      const diff = dx.minus(dy).abs();
      if (diff.lte(absTol)) return true;
      const scale = Decimal.max(dx.abs(), dy.abs());
      if (diff.lte(relTol.mul(scale))) return true;
    }
  }
  return false;
}

function dayIndex(d: Date | string): number {
  const date = d instanceof Date ? d : new Date(d);
  return Math.floor(date.getTime() / DAY_MS);
}

/** Same calendar day or adjacent (±1), absorbing trade-date vs settlement-date skew. */
export function withinDayTolerance(a: Date | string, b: Date | string): boolean {
  return Math.abs(dayIndex(a) - dayIndex(b)) <= 1;
}

/**
 * Map an import parser tag to the `transactions.source` value that would be written for it.
 * Mirrors the mapping in the confirm endpoint (imports.ts), kept here for shared use by the
 * preview endpoint and the upload-time annotator.
 */
export function parserToTxSource(parser: string): string {
  // AI-assisted entry (`propose_transactions`) is typed-in data the user confirms: it is a
  // manual entry, not a file upload — it carries no document, so it can never "enrich" a
  // committed row from another source (see classifyMatch).
  if (parser === "ai") return "manual";
  if (parser === "pytr") return "pytr";
  if (parser === "ibkr") return "ibkr";
  if (parser === "dkb-pdf" || parser === "tr-pdf") return "pdf";
  if (parser === "csv" || parser === "dkb" || parser === "tr-csv") return "csv";
  return "screenshot";
}

/** Parsers whose instruments carry ISINs and resolve via the EU/OpenFIGI path (DKB, Trade
 *  Republic, IBKR). Mirrors the `isEu` flag the confirm endpoint computes. */
export function isEuParser(parser: string): boolean {
  return (
    parser === "dkb" ||
    parser === "pytr" ||
    parser === "tr-csv" ||
    parser === "dkb-pdf" ||
    parser === "tr-pdf" ||
    parser === "ibkr"
  );
}

/**
 * Classify a cross-source economic match as **enrichment** or **duplicate**.
 *
 * Enrichment: the incoming import is from a *different* source than the committed transaction
 * **and** it brings new value (the import is a file upload carrying a document, or the draft
 * carries `taxComponents` — i.e. it's a richer PDF than a plain CSV row). Enrichment is
 * auto-applied at confirm time (links the PDF, folds in tax/fees) without a blocking 409.
 *
 * Duplicate: same source as the committed row, or no new value. These block at confirm time
 * so the user consciously decides whether to import or discard.
 *
 * **Two namespaces, two functions.** A *parser tag* (`"dkb-pdf"`, `"ai"`, …) and a
 * *transaction source* (`"pdf"`, `"manual"`, …) are different things that look alike, and
 * conflating them silently misclassifies: `parserToTxSource("pdf")` is `"screenshot"` because
 * `"pdf"` is not a parser tag. Use `classifyMatchByParser` for a parser tag and
 * `classifyMatchBySource` for a `transactions.source` value — never both.
 */
export function classifyMatchBySource(
  incomingTxSource: string,
  matchedTxSource: string,
  draftHasEnrichment: boolean,
): "enrichment" | "duplicate" {
  if (incomingTxSource !== matchedTxSource && draftHasEnrichment) {
    return "enrichment";
  }
  return "duplicate";
}

/**
 * Classify a match where the incoming side is identified by its **parser tag**
 * (`imp.parser`). The tag is converted to the transaction source it would write, then the
 * source comparison runs.
 */
export function classifyMatchByParser(
  importParser: string,
  matchedTxSource: string,
  draftHasEnrichment: boolean,
): "enrichment" | "duplicate" {
  return classifyMatchBySource(parserToTxSource(importParser), matchedTxSource, draftHasEnrichment);
}

/** A record reduced to the fields that decide economic identity. `key` is the caller's
 *  instrument identity: the resolved `instrumentId` at confirm time, or an ISIN/WKN at
 *  upload time (before instruments are resolved). */
export interface DedupCandidate {
  key: string | null | undefined;
  action: string;
  quantity: string;
  price: string;
  executedAt: Date | string;
}

/**
 * Match each draft against an already-committed record economically, count-aware. Returns
 * one entry per draft that matches a distinct committed record (greedy: each committed
 * record is consumed once). Generic over the committed type so callers get their own
 * payload back (source + executedAt at upload, source + externalId at confirm).
 */
export function findCrossSourceDuplicates<C extends DedupCandidate>(
  drafts: DedupCandidate[],
  committed: C[],
): Array<{ draftIndex: number; matched: C }> {
  const groups = new Map<string, C[]>();
  for (const c of committed) {
    if (!c.key) continue; // cash legs / unresolved instruments have no identity
    const g = `${c.key}|${actionClass(c.action)}`;
    let bucket = groups.get(g);
    if (!bucket) groups.set(g, (bucket = []));
    bucket.push(c);
  }

  const out: Array<{ draftIndex: number; matched: C }> = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    if (!d.key) continue;
    const bucket = groups.get(`${d.key}|${actionClass(d.action)}`);
    if (!bucket || bucket.length === 0) continue;
    const idx = bucket.findIndex(
      (c) =>
        decimalsClose(c.quantity, d.quantity) &&
        decimalsClose(c.price, d.price) &&
        withinDayTolerance(c.executedAt, d.executedAt),
    );
    if (idx >= 0) {
      out.push({ draftIndex: i, matched: bucket[idx] });
      bucket.splice(idx, 1); // consume — a committed row dedups at most one draft
    }
  }
  return out;
}

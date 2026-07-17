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
 */
export function parseLooseDecimal(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
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
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Two decimal strings equal within tolerance. Falls back to a trimmed string compare
 *  when either side isn't a finite number, so non-numeric values still match exactly. */
export function decimalsClose(a: string, b: string): boolean {
  const x = parseLooseDecimal(a);
  const y = parseLooseDecimal(b);
  if (x === null || y === null) return String(a).trim() === String(b).trim();
  const diff = Math.abs(x - y);
  return diff <= ABS_TOL || diff <= REL_TOL * Math.max(Math.abs(x), Math.abs(y));
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
 */
export function classifyMatch(
  importParser: string,
  matchedTxSource: string,
  draftHasEnrichment: boolean,
): "enrichment" | "duplicate" {
  const incomingTxSource = parserToTxSource(importParser);
  if (incomingTxSource !== matchedTxSource && draftHasEnrichment) {
    return "enrichment";
  }
  return "duplicate";
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

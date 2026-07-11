/**
 * Deterministic detector for account-level report PDFs (currently: Trade Republic's
 * annual tax certificate) uploaded through the general Add-Transaction flow —
 * `POST /imports/screenshot` (routes/imports/parse.ts).
 *
 * Unlike `detectDkbPdf`/`detectTrPdf`, this isn't a transaction parser: a report PDF has
 * no drafts to extract. Its only job is to recognize the document class early — before the
 * expensive/inappropriate vision-LLM fallback ever runs on it — so the upload route can
 * route it into the tax-reports inbox instead of silently returning zero drafts.
 *
 * IMPORTANT: this does NOT reuse `services/pytr/mapper.ts`'s `REPORT_TITLE_PREFIXES`
 * ("Jährlicher Steuerbericht"/"Jährlicher Steuerreport"). Those match TR's timeline
 * *event* `title` field (JSON metadata), which is worded differently from the PDF the
 * event links to. Verified directly against 4 real TR annual tax-certificate PDFs
 * (two cover-letter formats, tax years 2022-2025): the document's own printed title is
 * "Jahressteuerbescheinigung für das Jahr <year>" — the word "Steuerbericht" does not
 * appear in the PDF text at all. A bare "Steuerbescheinigung" match was considered and
 * rejected: DKB settlement PDFs routinely contain the boilerplate line "Keine
 * Steuerbescheinigung." (confirmed in dkb-pdf.test.ts fixtures), which would have
 * hijacked ordinary dividend/buy settlements away from the DKB parser. The compound word
 * "Jahressteuerbescheinigung" doesn't appear in any settlement-PDF fixture and is specific
 * to this document class.
 */

import type { DocumentCategory } from "@portfolio/schema";

/** The PDF's own printed title — distinct from `REPORT_TITLE_PREFIXES` in
 *  `services/pytr/mapper.ts`, which matches the TR timeline event's JSON title instead. */
const PDF_TITLE = "Jahressteuerbescheinigung";

/** Matches "...Jahressteuerbescheinigung für das Jahr 2024..." (confirmed across both real
 *  cover-letter formats) without requiring the literal "für das Jahr" wording, so a minor
 *  phrasing change still resolves the year as long as it's within 40 chars of the title.
 *  Anchored to the title so it doesn't grab an unrelated year elsewhere in the document
 *  (the PDF also contains reference years like "2009", "2018" in boilerplate legal text). */
const YEAR_RE = /Jahressteuerbescheinigung[^\d]{0,40}(\d{4})/;

export interface ReportPdfDetection {
  category: DocumentCategory;
  /** Best-effort reporting year, extracted near the matched title. Null if no year is
   *  found (e.g. a future cover-letter format change). */
  taxYear: number | null;
  /** The matched title, with year suffix when found (e.g. "Jahressteuerbescheinigung 2025"). */
  title: string;
}

/**
 * True when `text` (a PDF's extracted text) is Trade Republic's annual tax certificate.
 * Returns the category/taxYear/title to store it with, or null when no match is found.
 */
export function detectReportPdf(text: string): ReportPdfDetection | null {
  if (!text.includes(PDF_TITLE)) return null;

  const yearMatch = YEAR_RE.exec(text);
  const taxYear = yearMatch ? Number(yearMatch[1]) : null;
  const title = taxYear ? `${PDF_TITLE} ${taxYear}` : PDF_TITLE;
  return { category: "tax_report", taxYear, title };
}

/**
 * Unit tests for the report-PDF detector (services/parsers/report-pdf.ts) — recognizes
 * Trade Republic's annual tax certificate when uploaded through the general
 * Add-Transaction flow, so it can be routed into the tax-reports inbox instead of the
 * vision-LLM fallback.
 *
 * Fixture wording mirrors two real cover-letter formats confirmed by extracting text
 * (via unpdf, the same extractor the route uses) from real TR annual tax-certificate
 * PDFs across tax years 2022-2025 — not hand-guessed strings. Names/addresses are
 * replaced with placeholders; the surrounding document structure (title placement,
 * distance to the year) is preserved.
 */
import { describe, it, expect } from "vitest";
import { detectReportPdf } from "../../../src/services/parsers/report-pdf.js";

describe("detectReportPdf", () => {
  it("matches the newer cover-letter format, where the title appears once without a year before recurring with one", () => {
    // Confirmed shape (JSB-prefixed cover letter, tax years 2024/2025): the very first
    // occurrence of the title has no year nearby (a checkbox line), and only a later
    // occurrence pairs it with "für das Jahr <year>". The detector must not stop at the
    // first, year-less occurrence.
    const text =
      "Max Mustermann Musterstr. 1 12345 Musterstadt Trade Republic Bank GmbH Berlin, 06.05.2025 " +
      "Jahressteuerbescheinigung ☒ Bescheinigung für alle Privatkonten und / oder -depots " +
      "☐ Verlustbescheinigung im Sinne des § 43a EStG Seit dem Jahr 2009 ist eine " +
      "Jahressteuerbescheinigung für das Jahr 2024 nach den Vorschriften zur Abgeltungsteuer " +
      "auf dem amtlich vorgeschriebenen Muster zu erstellen.";
    expect(detectReportPdf(text)).toEqual({
      category: "tax_report",
      taxYear: 2024,
      title: "Jahressteuerbescheinigung 2024",
    });
  });

  it("matches the older cover-letter format, where the title and year appear together up front", () => {
    // Confirmed shape (pb-prefixed cover letter, tax years 2022/2023): "für das Jahr
    // <year>" follows the title within a few words on its very first occurrence.
    const text =
      "anbei erhalten Sie die Jahressteuerbescheinigung für das Jahr 2022 Sehr geehrte Damen " +
      "und Herren, anbei erhalten Sie die Jahressteuerbescheinigung. Die Jahressteuerbescheinigung " +
      "bezieht sich auf Ihr nachfolgend benanntes Depot.";
    expect(detectReportPdf(text)).toEqual({
      category: "tax_report",
      taxYear: 2022,
      title: "Jahressteuerbescheinigung 2022",
    });
  });

  it("returns taxYear: null when no year is found anywhere near the title", () => {
    const text = "Jahressteuerbescheinigung für Ihr Depot";
    expect(detectReportPdf(text)).toEqual({
      category: "tax_report",
      taxYear: null,
      title: "Jahressteuerbescheinigung",
    });
  });

  it("does not pick up an unrelated year far from the title", () => {
    // Real documents contain unrelated reference years in later boilerplate (e.g. "Seit
    // dem Jahr 2009 ...", "... seit 2018 ..."); the year must come from within the bounded
    // window right after the title, not from anywhere in the document.
    const text = `Jahressteuerbescheinigung für Ihr Depot. ${"x".repeat(200)} Stand: 2019`;
    const result = detectReportPdf(text);
    expect(result?.taxYear).toBeNull();
  });

  it("returns null for a DKB settlement PDF's 'Keine Steuerbescheinigung.' boilerplate", () => {
    // Regression guard: a bare "Steuerbescheinigung" match would false-positive here —
    // real DKB dividend/buy settlement PDFs contain this exact boilerplate line (see
    // dkb-pdf.test.ts fixtures). Only the more specific "Jahressteuerbescheinigung"
    // (annual tax certificate) compound word should match.
    const text =
      "Berechnungsgrundlage für die Kapitalertragsteuer 0,00 EUR Ausmachender Betrag 0,65+ EUR " +
      "Lagerstelle Clearstream Banking FFM (849000 / 40030000) Den Betrag buchen wir mit " +
      "Wertstellung 12.12.2025 zu Gunsten des Kontos. Keine Steuerbescheinigung.";
    expect(detectReportPdf(text)).toBeNull();
  });

  it("returns null for a normal settlement PDF (not a report)", () => {
    const text =
      "TRADE REPUBLIC BANK GMBH DATUM 23.06.2026 AUSFÜHRUNG 30bf-b0e9 DEPOT 1234567890 WERTPAPIERABRECHNUNG POSITION ANZAHL PREIS BETRAG";
    expect(detectReportPdf(text)).toBeNull();
  });

  it("returns null for unrelated text", () => {
    expect(detectReportPdf("just some random PDF content")).toBeNull();
    expect(detectReportPdf("")).toBeNull();
  });
});

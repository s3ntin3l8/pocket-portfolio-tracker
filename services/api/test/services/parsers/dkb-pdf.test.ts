import { describe, it, expect } from "vitest";
import { detectDkbPdf, parseDkbPdf } from "../../../src/services/parsers/dkb-pdf.js";

// Sanitised DKB PDF text layers (names/account numbers replaced with the same placeholder
// convention as imports-dkb-pdf.test.ts's fixture), modelled on real account statements
// examined during the #508 investigation but stripped of every personal/account identifier.
// Kept close to what `extractPdfText` produces (unpdf's flattened, space-joined stream) —
// collapse() in the parser normalizes whitespace, so line breaks here don't matter.

// "Ertragsabrechnung Dividenden" — a single foreign (USD) equity dividend.
const DKB_DIVIDEND_TEXT =
  "Frau Max Mustermann Depotnummer 999999001 Kundennummer 0000000000 Abrechnungsnr. " +
  "11111111111 Datum 12.12.2025 Dividendengutschrift Nominale Wertpapierbezeichnung ISIN " +
  "(WKN) Stück 1 MICROSOFT CORP. REGISTERED SHARES DL-,00000625 US5949181045 (870747) " +
  "Zahlbarkeitstag 11.12.2025 Bestandsstichtag 19.11.2025 Ex-Tag 20.11.2025 Devisenkurs " +
  "EUR / USD 1,1777 Devisenkursdatum 12.12.2025 Dividende pro Stück 0,91 USD Herkunftsland " +
  "USA Art der Dividende Quartalsdividende Dividendengutschrift 0,91 USD 0,77+ EUR " +
  "Umrechnung in EUR 0,77 EUR Einbehaltene Quellensteuer 15 % auf 0,91 USD 0,12- EUR " +
  "Anrechenbare Quellensteuer 15 % auf 0,77 EUR 0,12 EUR Kapitalertragsteuerpflichtige " +
  "Dividende 0,77 EUR Verrechneter Sparer-Pauschbetrag 0,77 - EUR Berechnungsgrundlage für " +
  "die Kapitalertragsteuer 0,00 EUR Ausmachender Betrag 0,65+ EUR Den Betrag buchen wir mit " +
  "Wertstellung 12.12.2025 zu Gunsten des Kontos 0000000000 (IBAN DE00 0000 0000 0000 0000 " +
  "00), BLZ 120 300 00 (BIC BYLADEM1001).";

// "Ausschüttung Investmentfonds" — a domestic (EUR) ETF distribution with partial
// exemption. Note the ABBREVIATED "pro St." (not "pro Stück"/"pro Anteil") — a real-world
// wording variant that a naive regex would silently miss.
const DKB_FUND_DISTRIBUTION_TEXT =
  "Frau Max Mustermann Depotnummer 999999002 Kundennummer 0000000000 Abrechnungsnr. " +
  "22222222222 Datum 17.11.2021 Ausschüttung Investmentfonds Nominale " +
  "Wertpapierbezeichnung ISIN (WKN) Stück 8,348 AMUNDI IND.SOL.-A.IN.MSCI E.M. ACT.NOM." +
  "UCITS ETF DR D ON LU1737652583 (A2H9Q0) Zahlbarkeitstag 18.11.2021 Bestandsstichtag " +
  "15.11.2021 Ex-Tag 16.11.2021 Ausschüttung pro St. 1,200000000 EUR mit Teilfreistellung " +
  "(Aktien- fonds) 0,840000000 EUR Herkunftsland Luxemburg Ausschüttung 10,02+ EUR davon " +
  "steuerfreier Anteil wg. Teilfreistellung 3,01 EUR Kapitalertragsteuerpfl. Ertrag nach " +
  "Teilfreistellung 7,01 EUR Verrechneter Sparer-Pauschbetrag 7,01 - EUR " +
  "Berechnungsgrundlage für die Kapitalertragsteuer 0,00 EUR Ausmachender Betrag 10,02+ " +
  "EUR Den Betrag buchen wir mit Wertstellung 18.11.2021 zu Gunsten des Kontos 0000000000 " +
  "(IBAN DE00 0000 0000 0000 0000 00), BLZ 120 300 00 (BIC BYLADEM1001).";

describe("parseDkbPdf — dividend/distribution shares & per-share (#508)", () => {
  it("extracts shares, perShare, nativeCurrency and grossNative from a foreign dividend", () => {
    expect(detectDkbPdf(DKB_DIVIDEND_TEXT)).toBe(true);
    const { drafts } = parseDkbPdf(DKB_DIVIDEND_TEXT);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      action: "dividend",
      isin: "US5949181045",
      quantity: "0",
      price: "0.65", // net EUR credited (Ausmachender Betrag) — unaffected by this change
      shares: "1",
      perShare: "0.91",
      nativeCurrency: "USD",
      grossNative: "0.91",
    });
  });

  it("extracts shares and perShare from a domestic EUR fund distribution abbreviated 'pro St.' (not 'pro Stück'/'pro Anteil')", () => {
    expect(detectDkbPdf(DKB_FUND_DISTRIBUTION_TEXT)).toBe(true);
    const { drafts } = parseDkbPdf(DKB_FUND_DISTRIBUTION_TEXT);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      action: "dividend",
      assetClass: "etf",
      isin: "LU1737652583",
      quantity: "0",
      price: "10.02", // Ausmachender Betrag — no withholding on a domestic EUR distribution
      shares: "8.348",
      // The FIRST (gross, pre-Teilfreistellung) rate — 8.348 × 1.2 ≈ 10.02 (Ausschüttung).
      perShare: "1.200000000",
    });
    // A domestic EUR payment carries no meaningful native currency/FX — same convention as
    // the TR PDF parser (`isForeign` gate).
    expect(drafts[0].nativeCurrency).toBeUndefined();
    expect(drafts[0].grossNative).toBeUndefined();
  });
});

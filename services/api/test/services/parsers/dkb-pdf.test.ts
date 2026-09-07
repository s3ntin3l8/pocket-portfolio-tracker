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

// Kapitalmaßnahme — taxable Fondsverschmelzung *confirmation* (Umbuchung): both legs +
// Kurswert. A2H9QY (LU1737652237) merges into A3DH0A (IE000CNSFAR2) at ratio 1 : 7,4817192.
const DKB_MERGER_TEXT =
  "10919 Berlin Frau Max Mustermann Schloßgasse 1e 85120 Hepberg Seite 1 von 4 Depotnummer " +
  "506740786 Kundennummer 0000000000 Max Mustermann Belegnummer 61395576 Datum 23.01.2024 " +
  "Kapitalmaßnahme LU17376522370100 0883.01232222.0022362KM52 Steuerwirksame " +
  "Fondsverschmelzung Nominale Wertpapierbezeichnung ISIN (WKN) Stück 48,1464 AIS-AMUNDI " +
  "INDEX MSCI WORLD ACT.NOM.UCITS ETF DR D ON LU1737652237 (A2H9QY) Sehr geehrte Frau " +
  "Mustermann, Ihren Depotbestand haben wir mit Valuta 23.01.2024 zu folgenden Bedingungen " +
  "umgebucht: Ex-Tag: 18.01.2024 Verhältnis: 1 : 7,4817192 Ausbuchung Stück 48,1464- " +
  "AIS-AMUNDI INDEX MSCI WORLD ACT.NOM.UCITS ETF DR D ON LU1737652237 (A2H9QY) Einbuchung " +
  "Stück 360,2180 AM.ETF I.-MSCI WORLD U.ETF REG. SHS DIS. ON Wertpapierrechnung " +
  "Großbritannien IE000CNSFAR2 (A3DH0A) Als Ergebnis der Fondsverschmelzung buchen wir Ihre " +
  "Anteile um. Veräußerung infolge Kapitalmaßnahme Kurswert 3.869,77 EUR steuerrelevanter " +
  "Bewertungskurs 87,4238889 USD Devisenkurs 1,0877 USD/EUR Veräußerungsergebnis " +
  "(Differenzmethode) 169,89+ EUR Mit freundlichen Grüßen Deutsche Kreditbank AG";

// The earlier *announcement* (Anschreiben): same merger but the ratio isn't published yet,
// so there's no Ausbuchung/Einbuchung/Kurswert — it can't produce the merged-in quantity.
const DKB_MERGER_ANNOUNCEMENT_TEXT =
  "10919 Berlin Frau Max Mustermann Depotnummer 506740786 Belegnummer 51710196 Datum " +
  "28.12.2023 Kapitalmaßnahme Steuerwirksame Fondsverschmelzung Nominale Wertpapierbezeichnung " +
  "ISIN (WKN) Stück 44,8329 AIS-AMUNDI INDEX MSCI WORLD ACT.NOM.UCITS ETF DR D ON " +
  "LU1737652237 (A2H9QY) Ex-Tag 18.01.2024 Umtauschverhältnis noch nicht veröffentlicht ISIN " +
  "(WKN) neu IE000CNSFAR2 (A3DH0A) Mit freundlichen Grüßen Deutsche Kreditbank AG";

// Merger document with no parseable Valuta (no "Valuta" clause) — only the document-level
// "Datum" survives. exDate should fall back to that, NOT to `new Date()`.
const DKB_MERGER_NO_VALUTA =
  "Depotnummer 506740786 Belegnummer 61395576 Datum 23.01.2024 Kapitalmaßnahme " +
  "Steuerwirksame Fondsverschmelzung Nominale Wertpapierbezeichnung ISIN (WKN) Stück 48,1464 " +
  "AIS-AMUNDI INDEX MSCI WORLD ACT.NOM.UCITS ETF DR D ON LU1737652237 (A2H9QY) " +
  "Ex-Tag 18.01.2024 Ausbuchung Stück 48,1464- AIS-AMUNDI INDEX MSCI WORLD ACT.NOM.UCITS " +
  "ETF DR D ON LU1737652237 (A2H9QY) Einbuchung Stück 360,2180 AM.ETF I.-MSCI WORLD U.ETF " +
  "REG. SHS DIS. ON Wertpapierrechnung Großbritannien IE000CNSFAR2 (A3DH0A) Veräußerung " +
  "infolge Kapitalmaßnahme Kurswert 3.869,77 EUR Mit freundlichen Grüßen Deutsche Kreditbank AG";

describe("parseDkbPdf — Kapitalmaßnahme fund merger (Fondsverschmelzung) (#577)", () => {
  it("detects a taxable merger confirmation but not the incomplete announcement", () => {
    expect(detectDkbPdf(DKB_MERGER_TEXT)).toBe(true);
    expect(detectDkbPdf(DKB_MERGER_ANNOUNCEMENT_TEXT)).toBe(false);
  });

  it("emits a sell+buy pair tagged kind:merger, priced at the Kurswert", () => {
    const { drafts, errors, accountNumber } = parseDkbPdf(DKB_MERGER_TEXT);
    expect(errors).toEqual([]);
    expect(accountNumber).toBe("506740786");
    expect(drafts).toHaveLength(2);

    const sell = drafts.find((d) => d.action === "sell")!;
    const buy = drafts.find((d) => d.action === "buy")!;

    expect(sell).toMatchObject({
      action: "sell",
      isin: "LU1737652237",
      wkn: "A2H9QY",
      quantity: "48.1464",
      price: "80.37506439", // 3869,77 / 48,1464
      total: "3869.77",
      kind: "merger",
      currency: "EUR",
    });
    expect(buy).toMatchObject({
      action: "buy",
      isin: "IE000CNSFAR2",
      wkn: "A3DH0A",
      quantity: "360.2180",
      price: "10.74285572", // 3869,77 / 360,218
      total: "3869.77",
      kind: "merger",
      assetClass: "etf",
    });
    expect(sell.executedAt.toISOString()).toBe("2024-01-23T00:00:00.000Z"); // Valuta
  });

  it("emits a mergerCA alongside the sell+buy pair with reciprocal ratios", () => {
    const { mergerCA } = parseDkbPdf(DKB_MERGER_TEXT);
    expect(mergerCA).toBeDefined();
    expect(mergerCA!.fromIsin).toBe("LU1737652237");
    expect(mergerCA!.toIsin).toBe("IE000CNSFAR2");
    // Decimal division — exact ratio, full Decimal precision. Reciprocal of ratioTo.
    expect(mergerCA!.ratioFrom).toBe("0.13365906201244801759"); // 48.1464 / 360.2180
    expect(mergerCA!.ratioTo).toBe("7.4817224133060831132"); // 360.2180 / 48.1464
    // Reciprocity: ratioFrom × ratioTo ≈ 1 (computed via Decimal precision).
    const product = Number(mergerCA!.ratioFrom) * Number(mergerCA!.ratioTo);
    expect(product).toBeCloseTo(1, 9);
    expect(mergerCA!.taxableMarketValue).toBe("3869.77");
    expect(mergerCA!.exDate).toBe("2024-01-23"); // Valuta
  });

  it("does not parse the incomplete announcement into a merger or mergerCA", () => {
    // detectDkbPdf gates it out in the route; called directly it yields no merger drafts
    // and no mergerCA — confirmed via DKB's gating (announcement lacks Ausbuchung/Einbuchung/
    // Kurswert, so the merger branch doesn't fire).
    const r = parseDkbPdf(DKB_MERGER_ANNOUNCEMENT_TEXT);
    expect(r.drafts.some((d) => d.kind === "merger")).toBe(false);
    expect(r.mergerCA).toBeUndefined();
  });

  it("falls back exDate to the document Datum (not 'today') when Valuta is missing", () => {
    // Regression guard for a Phase 1 suggestion: a missing date must not silently
    // become "now" — that would re-date historical mergers at import time. With Valuta
    // absent but Datum present, we use Datum.
    const { mergerCA } = parseDkbPdf(DKB_MERGER_NO_VALUTA);
    expect(mergerCA).toBeDefined();
    expect(mergerCA!.exDate).toBe("2024-01-23"); // from "Datum 23.01.2024", NOT new Date()
  });
});

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

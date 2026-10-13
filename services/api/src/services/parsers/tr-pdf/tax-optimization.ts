import { toDateKey } from "@portfolio/core";
import type { ParsedTransaction, TaxComponents } from "@portfolio/schema";
import { toDecimalSafe } from "../../../lib/decimal-safe.js";
import { parseUs, parseTrDate, pushDraft, extractBuchung, type TrPdfResult } from "./helpers.js";

export function parseTrTaxOptimization(text: string): TrPdfResult {
  const drafts: ParsedTransaction[] = [];
  const errors: { line: number; message: string }[] = [];

  const depot = text.match(/\bDEPOT\s+(\d+)/)?.[1] ?? null;
  const headerDate = parseTrDate(text.match(/\bDATUM\s+(\d{2}\.\d{2}\.\d{4})/)?.[1]);

  const kapstPdf = parseUs(text.match(/Kapitalertrags?steuer\s+(-?[\d.]+)\s+EUR/)?.[1]);
  const solzPdf = parseUs(text.match(/Solidaritätszuschlag\s+(-?[\d.]+)\s+EUR/)?.[1]);

  const buchung = extractBuchung(text);
  const cashflow = parseUs(buchung.amountRaw);
  const date = buchung.date ?? headerDate;

  // Sign flips only (no accumulation), but kept in Decimal like every other stored
  // amount so toFixed rounds the decimal value, not its binary approximation (audit B12).
  const tax = cashflow != null ? toDecimalSafe(cashflow).neg().toFixed(2) : undefined;
  const taxComponents: TaxComponents = {};
  if (kapstPdf != null)
    taxComponents.kapitalertragsteuer = toDecimalSafe(kapstPdf).neg().toFixed(2);
  if (solzPdf != null)
    taxComponents.solidaritaetszuschlag = toDecimalSafe(solzPdf).neg().toFixed(2);

  const action = cashflow != null && toDecimalSafe(cashflow).isNeg() ? "withdrawal" : "deposit";
  const dateStr = date ? toDateKey(date) : undefined;
  const externalId = depot && dateStr ? `tr:taxopt:${depot}:${dateStr}` : undefined;

  pushDraft(
    {
      action,
      name: "Steuerliche Optimierung",
      quantity: "0",
      price: cashflow != null ? toDecimalSafe(cashflow).abs().toFixed(2) : "",
      tax: tax ?? undefined,
      taxComponents: Object.keys(taxComponents).length > 0 ? taxComponents : undefined,
      currency: "EUR",
      executedAt: date ?? undefined,
      externalId,
      confidence: 1,
    },
    drafts,
    errors,
  );

  return { drafts, errors, accountNumber: depot };
}

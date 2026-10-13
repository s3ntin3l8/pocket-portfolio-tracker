import { Decimal } from "decimal.js";
import { D, ZERO } from "../decimal.js";

/** Abgeltungsteuer 25% + Solidaritätszuschlag 5.5% of it = 26.375% (no church tax). */
export const DEFAULT_CAPITAL_GAINS_TAX_RATE = "0.26375";
const KAPEST_RATE = D("0.25");
const SOLI_RATE = D("0.055");
/** Church-tax (Kirchensteuer) rate on the Kapitalertragsteuer: 9% (8% in BW and BY). */
export const DEFAULT_CHURCH_TAX_RATE = "0.09";

/**
 * Effective flat tax rate on capital income (§32d EStG) as a decimal fraction string.
 *
 * - An explicitly configured `capitalGainsTaxRate` always wins (the user knows their
 *   own rate; it is also how a state with 8% church tax is expressed).
 * - Otherwise: Kapitalertragsteuer e = 25% / (1 + 0.25 * k) when church tax applies
 *   (k = church-tax rate, the KiSt itself being deductible from its own base), else 25%;
 *   total = e * (1 + soli 5.5% + k). Without church tax this is 26.375%; with k = 9%
 *   it is about 27.99%, with k = 8% about 27.82%.
 */
export function effectiveCapitalGainsTaxRate(input: {
  capitalGainsTaxRate?: string | null;
  churchTax?: boolean | null;
  churchTaxRate?: string;
}): string {
  const configured = input.capitalGainsTaxRate;
  if (configured != null && configured.trim() !== "") return configured;
  if (!input.churchTax) return DEFAULT_CAPITAL_GAINS_TAX_RATE;
  const k = D(input.churchTaxRate ?? DEFAULT_CHURCH_TAX_RATE);
  const e = KAPEST_RATE.div(D(1).plus(KAPEST_RATE.times(k)));
  return e.times(D(1).plus(SOLI_RATE).plus(k)).toDecimalPlaces(6).toString();
}

/**
 * Basiszins for the Vorabpauschale (§18 Abs. 4 InvStG), by calendar year, as published
 * by the Bundesfinanzministerium (derived by the Bundesbank at the first trading day of
 * the year). Years absent here are deliberately unknown — never guessed.
 */
export const BASISZINS_BY_YEAR: Readonly<Record<number, string>> = {
  2023: "0.0255", // BMF 4 Jan 2023 (Basiszins at 2 Jan 2023)
  2024: "0.0229", // BMF 5 Jan 2024, IV C 1 - S 1980-1/19/10038 :008
  2025: "0.0253", // BMF 10 Jan 2025, IV C 1 - S 1980/00230/009/002
  2026: "0.0320", // BMF Jan 2026, IV C 1 - S 1980/00230/012/001 (BStBl 2026 I S. 155)
};

/** Basiszins for `year`, or null (and a warning via `warn`) when no official value is known. */
export function basiszinsFor(year: number, warn?: (msg: string) => void): string | null {
  const v = BASISZINS_BY_YEAR[year];
  if (v === undefined) {
    warn?.(`No official Basiszins for ${year}; Vorabpauschale cannot be estimated.`);
    return null;
  }
  return v;
}

/**
 * Estimated Vorabpauschale base per share-holding when the broker supplies none:
 * Basisertrag = value at 1 Jan x Basiszins x 70%, prorated by full months held (1/12 per
 * month not held), capped at the actual fund increase in the year (value change plus
 * distributions) and floored at 0. Returns null when the year's Basiszins is unknown.
 */
export function estimateVorabpauschale(input: {
  year: number;
  valueStartOfYear: string;
  valueEndOfYear: string;
  distributions: string;
  monthsHeld?: number;
  warn?: (msg: string) => void;
}): string | null {
  const zins = basiszinsFor(input.year, input.warn);
  if (zins === null) return null;
  const months = Math.min(12, Math.max(0, input.monthsHeld ?? 12));
  const basisertrag = D(input.valueStartOfYear).times(zins).times("0.7").times(months).div(12);
  const increase = D(input.valueEndOfYear)
    .minus(D(input.valueStartOfYear))
    .plus(D(input.distributions));
  const capped = Decimal.min(basisertrag, Decimal.max(ZERO, increase));
  // Distributions already paid in the year reduce the pauschale.
  return Decimal.max(ZERO, capped.minus(D(input.distributions))).toFixed(2);
}

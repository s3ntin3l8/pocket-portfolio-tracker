import type { Decimal } from "decimal.js";

// Shared numeric-string helpers for the import parsers/mappers.
//
// These convert already-computed JS numbers into the plain decimal-string form the schema
// and Postgres `numeric` columns expect. They are presentation helpers, NOT money math: per
// the repo rule ("money is never a float"), monetary arithmetic is done with Decimal
// upstream; this only stringifies the result.

/**
 * Format a finite number as a plain decimal string: no exponent, trailing zeros trimmed,
 * and never an empty, lone-"-", or signed-zero ("-0") result (all normalize to "0").
 * Non-finite input (NaN/Infinity) also yields "0".
 *
 * `precision` caps the fractional digits before trimming (default 10 — enough for
 * reconstructed per-share prices without surfacing float noise).
 */
/**
 * Strip non-numeric characters (except `.` and `-`) from a raw string.
 * Used by CSV parsers to clean broker-formatted numbers.
 */
export function num(raw: string): string {
  return raw.replace(/[^0-9.-]/g, "");
}

export function formatDecimal(n: number, precision = 10): string {
  if (!Number.isFinite(n)) return "0";
  const s = n.toFixed(precision).replace(/\.?0+$/, "");
  return s === "" || s === "-" || s === "-0" ? "0" : s;
}

/**
 * {@link formatDecimal} for a `Decimal` — the same normalization (fixed `precision`
 * fractional digits, trailing zeros trimmed, no exponent, `-0`/empty → "0", non-finite →
 * "0") without ever round-tripping the value through a JS float.
 */
export function formatDec(d: Decimal, precision = 10): string {
  if (!d.isFinite()) return "0";
  const s = d.toFixed(precision).replace(/\.?0+$/, "");
  return s === "" || s === "-" || s === "-0" ? "0" : s;
}

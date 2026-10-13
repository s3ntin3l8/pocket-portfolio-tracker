import Decimal from "decimal.js";

/** Fraction string ("0.30") → percent string ("30"); "" for null/empty. No float math. */
export function fractionToPercent(fraction: string | null | undefined): string {
  if (!fraction) return "";
  return new Decimal(fraction).times(100).toString();
}

/** Percent string ("30", "12.5") → fraction string ("0.3", "0.125"); null unless 0–100. */
export function percentToFraction(percent: string): string | null {
  const v = percent.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const d = new Decimal(v);
  if (d.gt(100)) return null;
  return d.div(100).toString();
}

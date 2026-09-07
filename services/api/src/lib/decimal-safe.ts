import { Decimal } from "decimal.js";

export function toDecimalSafe(v: string | number | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  try {
    return new Decimal(v);
  } catch {
    return new Decimal(0);
  }
}

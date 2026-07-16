import { Decimal } from "decimal.js";

export const D = (v: string | number): Decimal => new Decimal(v);
export const ZERO = new Decimal(0);

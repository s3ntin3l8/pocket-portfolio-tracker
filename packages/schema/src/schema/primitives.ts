import { z } from "zod";

export const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/, "must be a decimal string");

export const currencyCode = z
  .string()
  .trim()
  .length(3)
  .transform((s) => s.toUpperCase());

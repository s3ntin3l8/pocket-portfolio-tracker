import { z } from "zod";
import { currencyCode } from "./primitives.js";

export const userUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  displayCurrency: currencyCode.optional(),
});
export type UserUpdate = z.infer<typeof userUpdateSchema>;

export const apiTokenCreateSchema = z.object({
  name: z.string().min(1).max(120),
  scope: z.enum(["read", "write"]).default("read"),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});
export type ApiTokenCreate = z.infer<typeof apiTokenCreateSchema>;

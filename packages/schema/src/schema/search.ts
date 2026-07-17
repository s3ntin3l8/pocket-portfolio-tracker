import { z } from "zod";
import { transactionTypeSchema } from "./enums.js";

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1),
  types: z.preprocess(
    (v) => (v == null ? undefined : Array.isArray(v) ? v : [v]),
    z.array(transactionTypeSchema).optional(),
  ),
  holderId: z.guid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

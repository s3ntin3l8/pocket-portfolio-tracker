import { z } from "zod";

export const documentCategorySchema = z.enum(["receipt", "tax_report"]);
export type DocumentCategory = z.infer<typeof documentCategorySchema>;

export const documentUploadFieldsSchema = z.object({
  category: documentCategorySchema.default("tax_report"),
  taxYear: z.coerce.number().int().min(1990).max(2100).optional(),
  portfolioId: z.string().uuid(),
});
export type DocumentUploadFields = z.infer<typeof documentUploadFieldsSchema>;

export const documentListQuerySchema = z.object({
  category: documentCategorySchema.optional(),
  portfolioId: z.string().uuid().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
});
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>;

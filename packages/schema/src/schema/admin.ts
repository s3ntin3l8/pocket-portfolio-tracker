import { z } from "zod";

export const providerSettingUpdateSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  priority: z.number().int().min(0),
});
export type ProviderSettingUpdate = z.infer<typeof providerSettingUpdateSchema>;
export const providerSettingsUpdateSchema = z.array(providerSettingUpdateSchema);

/** The AI tasks that each pick exactly one provider + model. */
export const aiTaskSchema = z.enum(["vision", "chat"]);
export type AiTask = z.infer<typeof aiTaskSchema>;

export const aiEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type AiEffort = z.infer<typeof aiEffortSchema>;

/**
 * PATCH /admin/ai/tasks/:task. `provider: null` switches the task off. A provider needs a
 * model (checked by the route, which also knows whether the provider is configured).
 */
export const aiTaskUpdateSchema = z.object({
  provider: z.string().min(1).nullable(),
  model: z.string().trim().min(1).max(200).nullable().optional(),
  /** Claude only; null/absent clears it. */
  effort: aiEffortSchema.nullable().optional(),
});
export type AiTaskUpdate = z.infer<typeof aiTaskUpdateSchema>;

/** PATCH /admin/ai/providers/:id: options that are not credentials. */
export const aiProviderUpdateSchema = z.object({
  /** OpenRouter: allow endpoints that may retain/train on prompts. null = default (deny). */
  allowDataCollection: z.boolean().nullable().optional(),
});
export type AiProviderUpdate = z.infer<typeof aiProviderUpdateSchema>;

export const providerCredentialSchema = z
  .object({
    apiKey: z.string().min(1).optional(),
    urlOverride: z.string().url().optional(),
  })
  .refine((v) => v.apiKey !== undefined || v.urlOverride !== undefined, {
    message: "at least one of apiKey or urlOverride is required",
  });
export type ProviderCredentialInput = z.infer<typeof providerCredentialSchema>;

export const importStrategySchema = z.enum(["parser_first", "vision_only"]);
export type ImportStrategy = z.infer<typeof importStrategySchema>;
export const importSettingsUpdateSchema = z.object({
  strategy: importStrategySchema,
});
export type ImportSettingsUpdate = z.infer<typeof importSettingsUpdateSchema>;

export const storageProviderSchema = z.enum(["s3", "folder"]);
export type StorageProviderType = z.infer<typeof storageProviderSchema>;

export const storageSettingsUpdateSchema = z.object({
  activeProvider: storageProviderSchema.optional(),
  s3Endpoint: z.string().nullable().optional(),
  s3Region: z.string().min(1).nullable().optional(),
  s3Bucket: z.string().min(1).nullable().optional(),
  s3AccessKeyId: z.string().nullable().optional(),
  s3ForcePathStyle: z.boolean().nullable().optional(),
  s3SignedUrlTtl: z.number().int().positive().nullable().optional(),
  folderPath: z.string().nullable().optional(),
});
export type StorageSettingsUpdate = z.infer<typeof storageSettingsUpdateSchema>;

export const storageSecretSchema = z.object({
  apiKey: z.string().min(1),
});
export type StorageSecretInput = z.infer<typeof storageSecretSchema>;

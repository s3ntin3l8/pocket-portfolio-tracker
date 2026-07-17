import { z } from "zod";

export const providerSettingUpdateSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  priority: z.number().int().min(0),
});
export type ProviderSettingUpdate = z.infer<typeof providerSettingUpdateSchema>;
export const providerSettingsUpdateSchema = z.array(providerSettingUpdateSchema);

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

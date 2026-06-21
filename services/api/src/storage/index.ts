import { S3Provider } from "./s3-provider.js";
import type { StorageProvider } from "./types.js";

export type { StorageProvider } from "./types.js";
export { S3Provider } from "./s3-provider.js";

/**
 * Build a `StorageProvider` from the app's validated config.
 * Pure/synchronous — safe to call in tests with a fake config object.
 */
export function getStorage(config: {
  STORAGE_ENDPOINT: string;
  STORAGE_REGION: string;
  STORAGE_BUCKET: string;
  STORAGE_ACCESS_KEY: string;
  STORAGE_SECRET_KEY: string;
  STORAGE_FORCE_PATH_STYLE: boolean;
  STORAGE_SIGNED_URL_TTL: number;
}): StorageProvider {
  return new S3Provider({
    endpoint: config.STORAGE_ENDPOINT || undefined,
    region: config.STORAGE_REGION,
    bucket: config.STORAGE_BUCKET,
    accessKeyId: config.STORAGE_ACCESS_KEY,
    secretAccessKey: config.STORAGE_SECRET_KEY,
    forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
    signedUrlTtl: config.STORAGE_SIGNED_URL_TTL,
  });
}

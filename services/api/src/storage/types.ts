import type { Readable } from "stream";

/**
 * Storage provider interface. All backends (MinIO, AWS S3, Supabase Storage via the
 * S3-compatible endpoint) implement this contract so callers never import a concrete SDK.
 *
 * Keys are relative paths within the configured bucket (e.g. `"receipts/2024/scan.pdf"`).
 */
export interface StorageProvider {
  /**
   * Upload `body` under `key`. Overwrites an existing object silently.
   * `meta.mimeType` is stored as the object's Content-Type.
   */
  put(
    key: string,
    body: Buffer | Readable,
    meta: { mimeType: string; originalFilename?: string },
  ): Promise<void>;

  /**
   * Return a pre-signed GET URL valid for `expiresInSeconds` seconds.
   * Defaults to the configured `STORAGE_SIGNED_URL_TTL` (3600 s).
   */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;

  /** Permanently delete the object. No-ops silently if the key does not exist. */
  delete(key: string): Promise<void>;

  /** Return `true` if an object exists at `key`, `false` otherwise. */
  exists(key: string): Promise<boolean>;
}

import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { S3Provider } from "../storage/s3-provider.js";
import type { StorageProvider } from "../storage/types.js";
import { getStorage } from "../storage/index.js";

/**
 * Registers `app.storage` — an S3-compatible object-storage client configured from
 * the STORAGE_* env vars. Works against MinIO (local dev), AWS S3, Supabase Storage
 * (via its /storage/v1/s3 endpoint), Cloudflare R2, and Hetzner Object Storage.
 *
 * On non-production environments the plugin attempts to create the configured bucket
 * if it doesn't already exist, so local MinIO works out of the box.  The attempt is
 * best-effort: failures are logged and do NOT abort startup.
 */
export const storagePlugin = fp(async (app: FastifyInstance) => {
  const storage = getStorage(app.config);

  if (app.config.NODE_ENV !== "production") {
    // Auto-create the bucket in local dev / test so MinIO works without a manual step.
    if (storage instanceof S3Provider) {
      try {
        const created = await storage.ensureBucket();
        app.log.info(
          { bucket: app.config.STORAGE_BUCKET, created },
          "storage bucket ready",
        );
      } catch (err) {
        // Non-fatal: log and continue.  The bucket may exist with a policy that
        // rejects HeadBucket/CreateBucket even though PutObject works fine.
        app.log.warn(
          { err, bucket: app.config.STORAGE_BUCKET },
          "storage: bucket ensure failed (non-fatal)",
        );
      }
    }
  }

  app.decorate("storage", storage);

  app.log.info(
    {
      endpoint: app.config.STORAGE_ENDPOINT || "(aws-default)",
      bucket: app.config.STORAGE_BUCKET,
    },
    "storage ready",
  );
});

declare module "fastify" {
  interface FastifyInstance {
    storage: StorageProvider;
  }
}

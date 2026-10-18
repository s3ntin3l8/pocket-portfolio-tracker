import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { StorageProvider, StorageStats } from "../storage/types.js";
import { getStorageProvider, S3Provider } from "../storage/index.js";

/** Whether the plugin probes (and creates) the S3 bucket at boot: only in development.
 *  Production backends are provisioned; under test the env defaults (no endpoint) would
 *  send that probe to AWS S3 from every test that builds an app. */
export function ensuresBucketAtBoot(nodeEnv: string): boolean {
  return nodeEnv === "development";
}

/**
 * Registers `app.storage` — a stable facade that delegates to the lazily-resolved,
 * DB-backed storage provider. The active backend (S3 or folder) is read from the
 * `storage_settings` table on first use and cached; `invalidateStorage()` drops the
 * cache so admin-UI config changes take effect without a restart.
 *
 * Works against MinIO (local dev), AWS S3, Supabase Storage (/storage/v1/s3),
 * Cloudflare R2, Hetzner Object Storage, or a local filesystem folder.
 *
 * In development the plugin attempts to create the S3 bucket if it doesn't already
 * exist (best-effort — failure logs a warning and doesn't abort boot); see
 * {@link ensuresBucketAtBoot}.
 */
export const storagePlugin = fp(async (app: FastifyInstance) => {
  // Build the facade — every method resolves the cached backend on each call
  // so that `invalidateStorage()` is transparent to callers holding `app.storage`.
  const facade: StorageProvider = {
    async put(key, body, meta) {
      const p = await getStorageProvider(app);
      return p.put(key, body, meta);
    },
    async getSignedUrl(key, expiresInSeconds, opts) {
      const p = await getStorageProvider(app);
      return p.getSignedUrl(key, expiresInSeconds, opts);
    },
    async move(srcKey, destKey, meta) {
      const p = await getStorageProvider(app);
      return p.move(srcKey, destKey, meta);
    },
    async delete(key) {
      const p = await getStorageProvider(app);
      return p.delete(key);
    },
    async exists(key) {
      const p = await getStorageProvider(app);
      return p.exists(key);
    },
    async get(key) {
      const p = await getStorageProvider(app);
      return p.get(key);
    },
    async stats(): Promise<StorageStats> {
      const p = await getStorageProvider(app);
      if (!p.stats) return { objectCount: 0, totalBytes: 0 };
      return p.stats();
    },
  };

  app.decorate("storage", facade);

  // In development, eagerly resolve the backend once to trigger the bucket-ensure
  // side-effect (best-effort — errors are logged, never fatal). Never under test: the
  // suite must stay hermetic (no request to AWS from every buildApp()).
  if (ensuresBucketAtBoot(app.config.NODE_ENV)) {
    getStorageProvider(app)
      .then(async (provider) => {
        if (provider instanceof S3Provider) {
          try {
            const created = await provider.ensureBucket();
            app.log.info({ created }, "storage bucket ready");
          } catch (err) {
            app.log.warn({ err }, "storage: bucket ensure failed (non-fatal)");
          }
        }
      })
      .catch((err) => {
        app.log.warn({ err }, "storage: provider resolution failed (non-fatal)");
      });
  }

  app.log.info({}, "storage plugin registered (provider resolved on first use)");
});

declare module "fastify" {
  interface FastifyInstance {
    storage: StorageProvider;
  }
}

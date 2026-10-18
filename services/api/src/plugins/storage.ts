import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { StorageProvider, StorageStats } from "../storage/types.js";
import { getStorageProvider, S3Provider } from "../storage/index.js";

/**
 * Whether the plugin probes (and creates) the S3 bucket at boot: only in development, and
 * only against an explicitly configured endpoint (a local MinIO, the case it exists for).
 * Production backends are provisioned. Without an endpoint the AWS SDK targets AWS S3
 * itself, which the env defaults (`STORAGE_PROVIDER=s3`, no `STORAGE_ENDPOINT`, path-style)
 * turn into a 301 — that probe used to leave the machine from every test that builds an
 * app, and from a dev machine with no MinIO.
 */
export function ensuresBucketAtBoot(
  nodeEnv: "development" | "production" | "test",
  provider: StorageProvider,
): provider is S3Provider {
  return nodeEnv === "development" && provider instanceof S3Provider && !!provider.endpoint;
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
  // side-effect (best-effort — errors are logged, never fatal) — against a configured
  // endpoint only, see ensuresBucketAtBoot. Never under test or in production.
  if (app.config.NODE_ENV === "development") {
    getStorageProvider(app)
      .then(async (provider) => {
        if (ensuresBucketAtBoot(app.config.NODE_ENV, provider)) {
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

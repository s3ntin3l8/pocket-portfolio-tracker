import type { FastifyInstance } from "fastify";
import { adminAuditLog } from "@portfolio/db";
import { storageSettingsUpdateSchema, storageSecretSchema } from "@portfolio/schema";
import {
  getStorageSettingsResponse,
  updateStorageSettings,
  setStorageSecret,
  clearStorageSecret,
} from "../../services/storage-settings.js";
import { invalidateStorage } from "../../storage/index.js";

export function registerStorageRoutes(app: FastifyInstance) {
  app.get("/admin/storage-providers", { preHandler: app.requireAdmin }, async () => {
    return getStorageSettingsResponse(app.db, app.config, app.encryption);
  });

  app.patch("/admin/storage-providers", { preHandler: app.requireAdmin }, async (request) => {
    const body = storageSettingsUpdateSchema.parse(request.body);
    await updateStorageSettings(app.db, body);
    await app.db.insert(adminAuditLog).values({
      actorSub: request.user!.authSub,
      action: "update_storage_settings",
      target: "storage",
      meta: { activeProvider: body.activeProvider ?? null },
    });
    invalidateStorage();
    return getStorageSettingsResponse(app.db, app.config, app.encryption);
  });

  app.put(
    "/admin/storage-providers/s3/secret",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      if (!app.encryption.isEnabled) {
        return reply.code(503).send({ error: "encryption_required" });
      }
      const { apiKey } = storageSecretSchema.parse(request.body);
      await setStorageSecret(app.db, app.encryption, apiKey);
      const keyHint = apiKey.length >= 4 ? `••••${apiKey.slice(-4)}` : "••••";
      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "set_storage_secret",
        target: "storage:s3",
        meta: { keyHint },
      });
      invalidateStorage();
      return getStorageSettingsResponse(app.db, app.config, app.encryption);
    },
  );

  app.delete(
    "/admin/storage-providers/s3/secret",
    { preHandler: app.requireAdmin },
    async (request) => {
      await clearStorageSecret(app.db);
      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "clear_storage_secret",
        target: "storage:s3",
        meta: null,
      });
      invalidateStorage();
      return getStorageSettingsResponse(app.db, app.config, app.encryption);
    },
  );

  app.post(
    "/admin/storage-providers/test",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      let provider;
      try {
        const body = (request.body as Record<string, unknown>) ?? {};
        const testKey = `__healthcheck/storage-test-${Date.now()}`;

        if (body.activeProvider === "folder" || (!body.activeProvider && app.storage)) {
          provider = app.storage;
        } else {
          provider = app.storage;
        }

        await provider.put(testKey, Buffer.from("storage-test"), { mimeType: "text/plain" });
        const ok = await provider.exists(testKey);
        await provider.delete(testKey);
        if (!ok) throw new Error("put succeeded but exists returned false");
        return { ok: true };
      } catch (err) {
        request.log.warn({ err }, "storage test connection failed");
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(200).send({ ok: false, error: message });
      }
    },
  );
}

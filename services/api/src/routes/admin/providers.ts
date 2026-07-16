import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { providerSettings, providerCredentials, adminAuditLog } from "@portfolio/db";
import { providerSettingsUpdateSchema, providerCredentialSchema } from "@portfolio/schema";
import { PROVIDER_REGISTRY, invalidateMarketData } from "../../services/market-data.js";
import { listProviders, providersResponse } from "./_shared.js";

export function registerProvidersRoutes(app: FastifyInstance) {
  app.get("/admin/providers", { preHandler: app.requireAdmin }, async () =>
    providersResponse(app, await listProviders(app)),
  );

  app.patch("/admin/providers", { preHandler: app.requireAdmin }, async (request, reply) => {
    const updates = providerSettingsUpdateSchema.parse(request.body);
    const knownIds = new Set(PROVIDER_REGISTRY.map((d) => d.id));
    const unknown = updates.filter((u) => !knownIds.has(u.id));
    if (unknown.length > 0) {
      return reply.code(400).send({ error: "unknown_provider", ids: unknown.map((u) => u.id) });
    }
    for (const u of updates) {
      await app.db
        .insert(providerSettings)
        .values({ provider: u.id, enabled: u.enabled, priority: u.priority })
        .onConflictDoUpdate({
          target: providerSettings.provider,
          set: { enabled: u.enabled, priority: u.priority, updatedAt: new Date() },
        });
    }
    await app.db.insert(adminAuditLog).values({
      actorSub: request.user!.authSub,
      action: "update_providers",
      target: updates.map((u) => u.id).join(","),
      meta: updates.reduce<Record<string, unknown>>(
        (acc, u) => ({ ...acc, [u.id]: { enabled: u.enabled, priority: u.priority } }),
        {},
      ),
    });
    invalidateMarketData();
    return providersResponse(app, await listProviders(app));
  });

  app.put(
    "/admin/providers/:id/credential",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      if (!app.encryption.isEnabled) {
        return reply.code(503).send({ error: "encryption_required" });
      }
      const { id } = request.params as { id: string };
      if (!PROVIDER_REGISTRY.some((d) => d.id === id)) {
        return reply.code(404).send({ error: "unknown_provider" });
      }
      const body = providerCredentialSchema.parse(request.body);
      const apiKeyEnc = body.apiKey ? app.encryption.encryptString(body.apiKey) : null;

      await app.db
        .insert(providerCredentials)
        .values({
          provider: id,
          ...(apiKeyEnc !== null ? { apiKeyEnc } : {}),
          ...(body.urlOverride !== undefined ? { urlOverride: body.urlOverride } : {}),
        })
        .onConflictDoUpdate({
          target: providerCredentials.provider,
          set: {
            ...(apiKeyEnc !== null ? { apiKeyEnc } : {}),
            ...(body.urlOverride !== undefined ? { urlOverride: body.urlOverride } : {}),
            updatedAt: new Date(),
          },
        });

      const keyHint = body.apiKey
        ? body.apiKey.length >= 4
          ? `••••${body.apiKey.slice(-4)}`
          : "••••"
        : undefined;
      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "set_credential",
        target: id,
        meta: { keyHint: keyHint ?? null, hasUrl: Boolean(body.urlOverride) },
      });

      invalidateMarketData();
      return providersResponse(app, await listProviders(app));
    },
  );

  app.delete(
    "/admin/providers/:id/credential",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!PROVIDER_REGISTRY.some((d) => d.id === id)) {
        return reply.code(404).send({ error: "unknown_provider" });
      }
      await app.db.delete(providerCredentials).where(eq(providerCredentials.provider, id));
      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "clear_credential",
        target: id,
        meta: null,
      });
      invalidateMarketData();
      return providersResponse(app, await listProviders(app));
    },
  );
}

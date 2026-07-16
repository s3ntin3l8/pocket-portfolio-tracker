import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { providerCredentials, adminAuditLog, visionProviderSettings } from "@portfolio/db";
import { providerSettingsUpdateSchema, providerCredentialSchema } from "@portfolio/schema";
import {
  VISION_PROVIDER_REGISTRY,
  resolveVisionProviderConfig,
  resolveVisionCredentials,
  invalidateScreenshotParser,
} from "../../services/screenshot-parser.js";

async function listVisionProviders(app: FastifyInstance) {
  const [rows, credRows] = await Promise.all([
    app.db
      .select({
        provider: visionProviderSettings.provider,
        enabled: visionProviderSettings.enabled,
        priority: visionProviderSettings.priority,
      })
      .from(visionProviderSettings),
    app.db
      .select({
        provider: providerCredentials.provider,
        apiKeyEnc: providerCredentials.apiKeyEnc,
        urlOverride: providerCredentials.urlOverride,
      })
      .from(providerCredentials)
      .then((rs) => rs.filter((r) => r.provider.startsWith("vision:"))),
  ]);

  const credMap = new Map(credRows.map((r) => [r.provider.slice("vision:".length), r]));
  const credentials = await resolveVisionCredentials();

  return resolveVisionProviderConfig(rows, credentials).map((p) => {
    const cred = credMap.get(p.id);
    const hasKey = Boolean(cred?.apiKeyEnc);
    let keyHint: string | null = null;
    if (hasKey && cred?.apiKeyEnc) {
      try {
        const plain = app.encryption.decryptString(cred.apiKeyEnc);
        keyHint = plain.length >= 4 ? `••••${plain.slice(-4)}` : "••••";
      } catch {
        keyHint = "••••";
      }
    }
    const hasUrl = Boolean(cred?.urlOverride);
    const vDesc = VISION_PROVIDER_REGISTRY.find((d) => d.id === p.id);
    const keySource: "db" | "env" | null =
      hasKey || hasUrl ? "db" : vDesc?.keyEnvVar && process.env[vDesc.keyEnvVar] ? "env" : null;
    return { ...p, hasKey, keyHint, hasUrl, keySource };
  });
}

function visionProvidersResponse(
  app: FastifyInstance,
  providers: Awaited<ReturnType<typeof listVisionProviders>>,
) {
  return { providers, encryptionEnabled: app.encryption.isEnabled };
}

export function registerVisionProvidersRoutes(app: FastifyInstance) {
  app.get("/admin/vision-providers", { preHandler: app.requireAdmin }, async () =>
    visionProvidersResponse(app, await listVisionProviders(app)),
  );

  app.patch("/admin/vision-providers", { preHandler: app.requireAdmin }, async (request, reply) => {
    const updates = providerSettingsUpdateSchema.parse(request.body);
    const knownIds = new Set(VISION_PROVIDER_REGISTRY.map((d) => d.id));
    const unknown = updates.filter((u) => !knownIds.has(u.id));
    if (unknown.length > 0) {
      return reply.code(400).send({ error: "unknown_provider", ids: unknown.map((u) => u.id) });
    }
    for (const u of updates) {
      await app.db
        .insert(visionProviderSettings)
        .values({ provider: u.id, enabled: u.enabled, priority: u.priority })
        .onConflictDoUpdate({
          target: visionProviderSettings.provider,
          set: { enabled: u.enabled, priority: u.priority, updatedAt: new Date() },
        });
    }
    await app.db.insert(adminAuditLog).values({
      actorSub: request.user!.authSub,
      action: "update_vision_providers",
      target: updates.map((u) => u.id).join(","),
      meta: updates.reduce<Record<string, unknown>>(
        (acc, u) => ({ ...acc, [u.id]: { enabled: u.enabled, priority: u.priority } }),
        {},
      ),
    });
    invalidateScreenshotParser();
    return visionProvidersResponse(app, await listVisionProviders(app));
  });

  app.put(
    "/admin/vision-providers/:id/credential",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      if (!app.encryption.isEnabled) {
        return reply.code(503).send({ error: "encryption_required" });
      }
      const { id } = request.params as { id: string };
      if (!VISION_PROVIDER_REGISTRY.some((d) => d.id === id)) {
        return reply.code(404).send({ error: "unknown_provider" });
      }
      const body = providerCredentialSchema.parse(request.body);
      const namespacedId = `vision:${id}`;
      const apiKeyEnc = body.apiKey ? app.encryption.encryptString(body.apiKey) : null;

      await app.db
        .insert(providerCredentials)
        .values({
          provider: namespacedId,
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
        target: namespacedId,
        meta: { keyHint: keyHint ?? null, hasUrl: Boolean(body.urlOverride) },
      });

      invalidateScreenshotParser();
      return visionProvidersResponse(app, await listVisionProviders(app));
    },
  );

  app.delete(
    "/admin/vision-providers/:id/credential",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!VISION_PROVIDER_REGISTRY.some((d) => d.id === id)) {
        return reply.code(404).send({ error: "unknown_provider" });
      }
      const namespacedId = `vision:${id}`;
      await app.db
        .delete(providerCredentials)
        .where(eq(providerCredentials.provider, namespacedId));
      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "clear_credential",
        target: namespacedId,
        meta: null,
      });
      invalidateScreenshotParser();
      return visionProvidersResponse(app, await listVisionProviders(app));
    },
  );
}

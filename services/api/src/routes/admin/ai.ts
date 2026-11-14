import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  adminAuditLog,
  aiProviderSettings,
  aiTaskSettings,
  providerCredentials,
} from "@portfolio/db";
import {
  aiProviderUpdateSchema,
  aiTaskSchema,
  aiTaskUpdateSchema,
  providerCredentialSchema,
} from "@portfolio/schema";
import { listModels, clearModelCache } from "../../services/ai/models.js";
import {
  AI_PROVIDER_REGISTRY,
  AI_TASKS,
  env,
  findProvider,
  isLocalProvider,
  openAiRoot,
} from "../../services/ai/registry.js";
import {
  AI_CREDENTIAL_PREFIX,
  allowsDataCollection,
  loadAiConfig,
  resolveTask,
} from "../../services/ai/resolve.js";

// Compared normalised (trailing slash, `/v1`): the editor sends back the URL the view showed.
const sameUrl = (a: string | null | undefined, b: string) => openAiRoot(a ?? "") === openAiRoot(b);

const maskKey = (plain: string) => (plain.length >= 4 ? `••••${plain.slice(-4)}` : "••••");

/**
 * The admin view of the AI setup: one connection per provider (key/URL, shared by both tasks)
 * and the provider + model each task runs. Never carries a secret, only a masked hint.
 */
async function aiView(app: FastifyInstance) {
  const cfg = await loadAiConfig();
  const stored = new Map(cfg.credentialRows.map((r) => [r.provider, r]));

  const connections = AI_PROVIDER_REGISTRY.map((d) => {
    const cred = stored.get(d.id);
    const hasKey = Boolean(cred?.apiKeyEnc);
    const hasUrl = Boolean(cred?.urlOverride);
    const secret = cfg.credentials.get(d.id);
    // The key was already decrypted for `cfg`; a stored key that failed to decrypt has no hint.
    const keyHint = hasKey ? (secret?.apiKey ? maskKey(secret.apiKey) : "••••") : null;
    return {
      id: d.id,
      label: d.label,
      credential: d.credential,
      configured: d.isConfigured(secret),
      hasKey,
      keyHint,
      hasUrl,
      // Not a secret (a plain-text column), unlike the key: shown so the admin sees where it points.
      url: d.credential === "url" ? d.baseUrl(secret) : null,
      optionalKey: Boolean(d.optionalKeyEnvVar),
      keySource:
        hasKey || hasUrl ? ("db" as const) : env(d.credentialEnvVar) ? ("env" as const) : null,
      local: isLocalProvider(d, secret),
      allowDataCollection: d.id === "openrouter" ? allowsDataCollection(cfg, d.id) : null,
    };
  });

  const tasks = AI_TASKS.map((task) => {
    const t = resolveTask(task, cfg);
    return { task, provider: t.provider, model: t.model, effort: t.effort, usable: t.usable };
  });

  return { connections, tasks, encryptionEnabled: app.encryption.isEnabled };
}

export function registerAiRoutes(app: FastifyInstance) {
  app.get("/admin/ai", { preHandler: app.requireAdmin }, () => aiView(app));

  // Which provider + model a task runs. `provider: null` switches the task off.
  app.patch("/admin/ai/tasks/:task", { preHandler: app.requireAdmin }, async (request, reply) => {
    const task = aiTaskSchema.safeParse((request.params as { task: string }).task);
    if (!task.success) return reply.code(404).send({ error: "unknown_task" });
    const body = aiTaskUpdateSchema.parse(request.body);

    let model: string | null = null;
    let effort: string | null = null;
    if (body.provider !== null) {
      const d = findProvider(body.provider);
      if (!d) return reply.code(400).send({ error: "unknown_provider" });
      const cfg = await loadAiConfig();
      if (!d.isConfigured(cfg.credentials.get(d.id))) {
        return reply.code(400).send({ error: "provider_not_configured" });
      }
      model = body.model ?? null;
      if (!model) return reply.code(400).send({ error: "model_required" });
      effort = d.id === "claude" && task.data === "chat" ? (body.effort ?? null) : null;
    }

    await app.db
      .insert(aiTaskSettings)
      .values({ task: task.data, provider: body.provider, model, effort })
      .onConflictDoUpdate({
        target: aiTaskSettings.task,
        set: { provider: body.provider, model, effort, updatedAt: new Date() },
      });
    await app.db.insert(adminAuditLog).values({
      actorSub: request.user!.authSub,
      action: "update_ai_task",
      target: task.data,
      meta: { provider: body.provider, model, effort },
    });
    return aiView(app);
  });

  // Options of a provider that are not credentials (OpenRouter's data-collection switch).
  app.patch("/admin/ai/providers/:id", { preHandler: app.requireAdmin }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!findProvider(id)) return reply.code(404).send({ error: "unknown_provider" });
    if (id !== "openrouter") return reply.code(400).send({ error: "no_options" });
    const body = aiProviderUpdateSchema.parse(request.body);
    if (body.allowDataCollection === undefined) return aiView(app);

    await app.db
      .insert(aiProviderSettings)
      .values({ provider: id, allowDataCollection: body.allowDataCollection })
      .onConflictDoUpdate({
        target: aiProviderSettings.provider,
        set: { allowDataCollection: body.allowDataCollection, updatedAt: new Date() },
      });
    await app.db.insert(adminAuditLog).values({
      actorSub: request.user!.authSub,
      action: "update_ai_provider",
      target: id,
      meta: { allowDataCollection: body.allowDataCollection },
    });
    return aiView(app);
  });

  app.put(
    "/admin/ai/providers/:id/credential",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      if (!app.encryption.isEnabled) {
        return reply.code(503).send({ error: "encryption_required" });
      }
      const { id } = request.params as { id: string };
      const d = findProvider(id);
      if (!d) return reply.code(404).send({ error: "unknown_provider" });
      const body = providerCredentialSchema.parse(request.body);
      // A URL provider takes a key only where the descriptor allows one (an authenticated
      // OpenAI-compatible server); Ollama is URL-only.
      if (body.apiKey && d.credential === "url" && !d.optionalKeyEnvVar) {
        return reply.code(400).send({ error: "key_not_supported" });
      }
      const namespacedId = `${AI_CREDENTIAL_PREFIX}${id}`;
      const apiKeyEnc = body.apiKey ? app.encryption.encryptString(body.apiKey) : null;
      // A stored key belongs to the URL it was saved with: repointing the URL without a new key
      // drops it, so it can never be sent to a different host.
      let dropKey = false;
      if (apiKeyEnc === null && body.urlOverride !== undefined) {
        const [row] = await app.db
          .select({ url: providerCredentials.urlOverride, key: providerCredentials.apiKeyEnc })
          .from(providerCredentials)
          .where(eq(providerCredentials.provider, namespacedId));
        dropKey = Boolean(row?.key) && !sameUrl(row?.url, body.urlOverride);
      }

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
            ...(apiKeyEnc !== null ? { apiKeyEnc } : dropKey ? { apiKeyEnc: null } : {}),
            ...(body.urlOverride !== undefined ? { urlOverride: body.urlOverride } : {}),
            updatedAt: new Date(),
          },
        });
      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "set_credential",
        target: namespacedId,
        meta: {
          keyHint: body.apiKey ? maskKey(body.apiKey) : null,
          hasUrl: Boolean(body.urlOverride),
        },
      });
      clearModelCache(id);
      return aiView(app);
    },
  );

  app.delete(
    "/admin/ai/providers/:id/credential",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!findProvider(id)) return reply.code(404).send({ error: "unknown_provider" });
      const namespacedId = `${AI_CREDENTIAL_PREFIX}${id}`;
      await app.db
        .delete(providerCredentials)
        .where(eq(providerCredentials.provider, namespacedId));
      await app.db.insert(adminAuditLog).values({
        actorSub: request.user!.authSub,
        action: "clear_credential",
        target: namespacedId,
        meta: null,
      });
      clearModelCache(id);
      return aiView(app);
    },
  );

  // The provider's own model list (capability-filtered for the task), for the dropdown. A
  // provider failure is a 200 carrying `error`, so the UI can fall back to typing a model id.
  app.get(
    "/admin/ai/providers/:id/models",
    { preHandler: app.requireAdmin },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!findProvider(id)) return reply.code(404).send({ error: "unknown_provider" });
      const task = aiTaskSchema.safeParse((request.query as { task?: string }).task);
      if (!task.success) return reply.code(400).send({ error: "invalid_task" });
      const cfg = await loadAiConfig();
      return listModels(id, task.data, cfg.credentials.get(id));
    },
  );
}

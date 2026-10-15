import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { adminAuditLog, chatProviderSettings, chatSettings } from "@portfolio/db";
import { chatProvidersUpdateSchema } from "@portfolio/schema";
import {
  CHAT_PROVIDER_REGISTRY,
  effectivePin,
  loadChatConfig,
  resolveChatProviders,
  selectChatProvider,
} from "../../services/chat/registry.js";

const CHAT_SETTINGS_ID = 1;

/**
 * Admin view of the chat assistant's provider settings: per provider the effective
 * enable/priority/model and where each came from, the pin, and which provider answers chat
 * right now. Credentials are managed with the vision providers (they are shared).
 */
async function chatProvidersView() {
  const cfg = await loadChatConfig();
  const states = resolveChatProviders(cfg);
  const pin = effectivePin(cfg);
  const active = selectChatProvider(states, pin.value);
  return {
    providers: states.map((s) => ({
      ...s,
      modelEnvVar: CHAT_PROVIDER_REGISTRY.find((d) => d.id === s.id)!.modelEnvVar,
    })),
    pinned: pin.value,
    pinnedSource: pin.source,
    activeProvider: active?.id ?? null,
  };
}

export function registerChatProvidersRoutes(app: FastifyInstance) {
  app.get("/admin/chat-providers", { preHandler: app.requireAdmin }, chatProvidersView);

  app.patch("/admin/chat-providers", { preHandler: app.requireAdmin }, async (request, reply) => {
    const { providers, pinned } = chatProvidersUpdateSchema.parse(request.body);
    const known = new Set(CHAT_PROVIDER_REGISTRY.map((d) => d.id));
    const unknown = [...providers.map((p) => p.id), ...(pinned ? [pinned] : [])].filter(
      (id) => !known.has(id),
    );
    if (unknown.length > 0) {
      return reply.code(400).send({ error: "unknown_provider", ids: unknown });
    }

    for (const u of providers) {
      // Only the fields the request names are written; `null` clears an override.
      const set = {
        ...(u.enabled !== undefined ? { enabled: u.enabled } : {}),
        ...(u.priority !== undefined ? { priority: u.priority } : {}),
        ...(u.model !== undefined ? { model: u.model?.trim() || null } : {}),
      };
      await app.db
        .insert(chatProviderSettings)
        .values({ provider: u.id, ...set })
        .onConflictDoUpdate({
          target: chatProviderSettings.provider,
          set: { ...set, updatedAt: new Date() },
        });
    }
    if (pinned !== undefined) {
      await app.db
        .insert(chatSettings)
        .values({ id: CHAT_SETTINGS_ID, pinnedProvider: pinned })
        .onConflictDoUpdate({
          target: chatSettings.id,
          set: { pinnedProvider: pinned, updatedAt: new Date() },
        });
    }
    await app.db.insert(adminAuditLog).values({
      actorSub: request.user!.authSub,
      action: "update_chat_providers",
      target: providers.map((p) => p.id).join(",") || "pin",
      meta: {
        providers: providers.reduce<Record<string, unknown>>(
          (acc, p) => ({
            ...acc,
            [p.id]: { enabled: p.enabled, priority: p.priority, model: p.model },
          }),
          {},
        ),
        ...(pinned !== undefined ? { pinned } : {}),
      },
    });
    return chatProvidersView();
  });

  // Back to inheriting everything from the vision settings and the env vars.
  app.delete("/admin/chat-providers", { preHandler: app.requireAdmin }, async (request) => {
    await app.db.delete(chatProviderSettings);
    await app.db.delete(chatSettings).where(eq(chatSettings.id, CHAT_SETTINGS_ID));
    await app.db.insert(adminAuditLog).values({
      actorSub: request.user!.authSub,
      action: "reset_chat_providers",
      target: "chat",
      meta: null,
    });
    return chatProvidersView();
  });
}

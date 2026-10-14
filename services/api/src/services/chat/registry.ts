import { visionProviderSettings } from "@portfolio/db";
import { getDb } from "../../db/client.js";
import type { ResolvedSecret } from "../market-data.js";
import { resolveVisionCredentials, resolveVisionProviderConfig } from "../screenshot-parser.js";
import { AnthropicChatProvider } from "./anthropic.js";
import { OpenAICompatChatProvider } from "./openai-compat.js";
import type { ChatProvider } from "./types.js";

/**
 * A chat provider descriptor. The credentials are the same vendor credentials the vision
 * parsers use (an Anthropic key is an Anthropic key), so they are resolved through the same
 * encrypted `provider_credentials` rows and the admin's enable/priority settings for those
 * providers also decide which one answers chat. Only the model variables are chat-specific
 * — the vision defaults are vision models, useless for tool calling.
 */
export interface ChatProviderDescriptor {
  id: string;
  configured: (secret?: ResolvedSecret) => boolean;
  create: (secret?: ResolvedSecret) => ChatProvider;
}

const env = (name: string) => process.env[name]?.trim() || undefined;

export const CHAT_PROVIDER_REGISTRY: ChatProviderDescriptor[] = [
  {
    id: "claude",
    configured: (s) => Boolean(s?.apiKey ?? env("ANTHROPIC_API_KEY")),
    create: (s) =>
      new AnthropicChatProvider(s?.apiKey ?? env("ANTHROPIC_API_KEY") ?? "", {
        model: env("ANTHROPIC_CHAT_MODEL"),
        effort: env("ANTHROPIC_CHAT_EFFORT"),
      }),
  },
  {
    id: "openrouter",
    // A model is required: there is no safe default for tool-calling quality.
    configured: (s) =>
      Boolean((s?.apiKey ?? env("OPENROUTER_API_KEY")) && env("OPENROUTER_CHAT_MODEL")),
    create: (s) =>
      new OpenAICompatChatProvider({
        name: "openrouter",
        label: "OpenRouter",
        local: false,
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: s?.apiKey ?? env("OPENROUTER_API_KEY"),
        model: env("OPENROUTER_CHAT_MODEL") ?? "",
      }),
  },
  {
    id: "ollama",
    configured: (s) => Boolean((s?.url ?? env("OLLAMA_BASE_URL")) && env("OLLAMA_CHAT_MODEL")),
    create: (s) =>
      new OpenAICompatChatProvider({
        name: "ollama",
        label: "Ollama (local)",
        local: true,
        baseUrl: `${(s?.url ?? env("OLLAMA_BASE_URL") ?? "").replace(/\/+$/, "")}/v1`,
        model: env("OLLAMA_CHAT_MODEL") ?? "",
      }),
  },
];

/**
 * The provider that answers chat, or `null` when none is configured. Selection:
 * 1. `CHAT_PROVIDER` env pin (a provider id) when that provider is configured;
 * 2. otherwise the first provider that is enabled, configured for chat and ranked highest
 *    by the admin's provider priority.
 * Resolved per request (two tiny queries) so admin credential changes apply immediately.
 */
export async function getChatProvider(): Promise<ChatProvider | null> {
  const pinned = env("CHAT_PROVIDER")?.toLowerCase();

  // Tests (and DB-less setups) use env-only selection, like the vision factory.
  if (process.env.NODE_ENV === "test") {
    const ordered = pinned
      ? [...CHAT_PROVIDER_REGISTRY.filter((c) => c.id === pinned), ...CHAT_PROVIDER_REGISTRY]
      : CHAT_PROVIDER_REGISTRY;
    const d = ordered.find((c) => c.configured());
    return d ? d.create() : null;
  }

  const db = getDb();
  const [rows, credentials] = await Promise.all([
    db
      .select({
        provider: visionProviderSettings.provider,
        enabled: visionProviderSettings.enabled,
        priority: visionProviderSettings.priority,
      })
      .from(visionProviderSettings),
    resolveVisionCredentials(),
  ]);

  if (pinned) {
    const d = CHAT_PROVIDER_REGISTRY.find((c) => c.id === pinned);
    if (d && d.configured(credentials.get(d.id))) return d.create(credentials.get(d.id));
  }

  for (const p of resolveVisionProviderConfig(rows, credentials)) {
    if (!p.enabled) continue;
    const d = CHAT_PROVIDER_REGISTRY.find((c) => c.id === p.id);
    if (d && d.configured(credentials.get(d.id))) return d.create(credentials.get(d.id));
  }
  return null;
}

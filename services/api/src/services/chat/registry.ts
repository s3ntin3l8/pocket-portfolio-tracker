import { visionProviderSettings } from "@portfolio/db";
import { getDb } from "../../db/client.js";
import type { ResolvedSecret } from "../market-data.js";
import { resolveVisionCredentials, resolveVisionProviderConfig } from "../screenshot-parser.js";
import { AnthropicChatProvider } from "./anthropic.js";
import { GeminiChatProvider } from "./gemini.js";
import { isLocalUrl } from "./local-url.js";
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
    id: "gemini",
    // Gemini outranks OpenRouter and Ollama in the vision priority, and most deployments with
    // a Gemini vision key never meant to send chat there: chat is opt-in via a chat model.
    configured: (s) => Boolean((s?.apiKey ?? env("GEMINI_API_KEY")) && env("GEMINI_CHAT_MODEL")),
    create: (s) =>
      new GeminiChatProvider(s?.apiKey ?? env("GEMINI_API_KEY") ?? "", {
        model: env("GEMINI_CHAT_MODEL") ?? "",
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
        // Financial data: only route to providers that don't retain/train on prompts, unless
        // the operator opts out (some models have no such endpoint).
        extraBody:
          env("OPENROUTER_ALLOW_DATA_COLLECTION") === "true"
            ? undefined
            : { provider: { data_collection: "deny" } },
      }),
  },
  {
    id: "ollama",
    configured: (s) => Boolean((s?.url ?? env("OLLAMA_BASE_URL")) && env("OLLAMA_CHAT_MODEL")),
    create: (s) => {
      const baseUrl = (s?.url ?? env("OLLAMA_BASE_URL") ?? "").replace(/\/+$/, "");
      return new OpenAICompatChatProvider({
        name: "ollama",
        label: "Ollama (local)",
        // The URL may be remote (e.g. an admin override), so don't assume.
        local: isLocalUrl(baseUrl),
        baseUrl: `${baseUrl}/v1`,
        model: env("OLLAMA_CHAT_MODEL") ?? "",
      });
    },
  },
];

/**
 * The provider that answers chat, or `null` when none is configured. Selection:
 * 1. `CHAT_PROVIDER` env pin (a provider id): that provider or nothing — an unconfigured pin
 *    makes chat unavailable rather than falling through to another (possibly cloud) provider;
 * 2. otherwise the first provider that is enabled, configured for chat and ranked highest
 *    by the admin's provider priority.
 * Resolved per request (two tiny queries) so admin credential changes apply immediately.
 */
export async function getChatProvider(): Promise<ChatProvider | null> {
  const pinned = env("CHAT_PROVIDER")?.toLowerCase();

  // Tests (and DB-less setups) use env-only selection, like the vision factory.
  if (process.env.NODE_ENV === "test") {
    const d = (
      pinned ? CHAT_PROVIDER_REGISTRY.filter((c) => c.id === pinned) : CHAT_PROVIDER_REGISTRY
    ).find((c) => c.configured());
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

  // A pin is an explicit operator choice (typically "keep data local"): if that provider is
  // not usable, chat is unavailable — it never falls through to a different provider.
  if (pinned) {
    const d = CHAT_PROVIDER_REGISTRY.find((c) => c.id === pinned);
    return d && d.configured(credentials.get(d.id)) ? d.create(credentials.get(d.id)) : null;
  }

  for (const p of resolveVisionProviderConfig(rows, credentials)) {
    if (!p.enabled) continue;
    const d = CHAT_PROVIDER_REGISTRY.find((c) => c.id === p.id);
    if (d && d.configured(credentials.get(d.id))) return d.create(credentials.get(d.id));
  }
  return null;
}

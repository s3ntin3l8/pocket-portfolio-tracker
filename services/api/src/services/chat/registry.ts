import { chatProviderSettings, chatSettings, visionProviderSettings } from "@portfolio/db";
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
 * parsers use (an Anthropic key is an Anthropic key). Enable/priority default to the vision
 * settings but an admin can override them for chat, and so can the model: the vision defaults
 * are vision models, useless for tool calling. `model` below is already resolved
 * (admin setting, else the env var, else the adapter default).
 */
export interface ChatProviderDescriptor {
  id: string;
  label: string;
  /** Env var holding the chat model; the fallback when the admin has not chosen one. */
  modelEnvVar: string;
  /** The adapter's own default, for providers that have one. */
  defaultModel?: string;
  configured: (secret?: ResolvedSecret, model?: string) => boolean;
  create: (secret?: ResolvedSecret, model?: string) => ChatProvider;
}

const env = (name: string) => process.env[name]?.trim() || undefined;

export const CHAT_PROVIDER_REGISTRY: ChatProviderDescriptor[] = [
  {
    id: "claude",
    label: "Claude (Anthropic)",
    modelEnvVar: "ANTHROPIC_CHAT_MODEL",
    defaultModel: "claude-opus-5-5",
    configured: (s) => Boolean(s?.apiKey ?? env("ANTHROPIC_API_KEY")),
    create: (s, model) =>
      new AnthropicChatProvider(s?.apiKey ?? env("ANTHROPIC_API_KEY") ?? "", {
        model,
        effort: env("ANTHROPIC_CHAT_EFFORT"),
      }),
  },
  {
    id: "gemini",
    label: "Gemini (Google)",
    modelEnvVar: "GEMINI_CHAT_MODEL",
    // Gemini outranks OpenRouter and Ollama in the vision priority, and most deployments with
    // a Gemini vision key never meant to send chat there: chat is opt-in via a chat model.
    configured: (s, model) => Boolean((s?.apiKey ?? env("GEMINI_API_KEY")) && model),
    create: (s, model) =>
      new GeminiChatProvider(s?.apiKey ?? env("GEMINI_API_KEY") ?? "", { model: model ?? "" }),
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    modelEnvVar: "OPENROUTER_CHAT_MODEL",
    // A model is required: there is no safe default for tool-calling quality.
    configured: (s, model) => Boolean((s?.apiKey ?? env("OPENROUTER_API_KEY")) && model),
    create: (s, model) =>
      new OpenAICompatChatProvider({
        name: "openrouter",
        label: "OpenRouter",
        local: false,
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: s?.apiKey ?? env("OPENROUTER_API_KEY"),
        model: model ?? "",
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
    label: "Ollama (local)",
    modelEnvVar: "OLLAMA_CHAT_MODEL",
    configured: (s, model) => Boolean((s?.url ?? env("OLLAMA_BASE_URL")) && model),
    create: (s, model) => {
      const baseUrl = (s?.url ?? env("OLLAMA_BASE_URL") ?? "").replace(/\/+$/, "");
      return new OpenAICompatChatProvider({
        name: "ollama",
        label: "Ollama (local)",
        // The URL may be remote (e.g. an admin override), so don't assume.
        local: isLocalUrl(baseUrl),
        baseUrl: `${baseUrl}/v1`,
        model: model ?? "",
      });
    },
  },
];

/** The admin's chat overrides for one provider; null = inherit. */
export interface ChatProviderRow {
  provider: string;
  enabled: boolean | null;
  priority: number | null;
  model: string | null;
}

export interface ChatConfig {
  visionRows: { provider: string; enabled: boolean; priority: number }[];
  chatRows: ChatProviderRow[];
  /** The admin's pin (beats the `CHAT_PROVIDER` env var), or null. */
  pinned: string | null;
  credentials: Map<string, ResolvedSecret>;
}

export interface ChatProviderState {
  id: string;
  label: string;
  /** Usable for chat: credential present and a model resolved where one is required. */
  configured: boolean;
  enabled: boolean;
  enabledSource: "chat" | "vision";
  priority: number;
  prioritySource: "chat" | "vision";
  model: string | null;
  modelSource: "db" | "env" | "default" | null;
}

/**
 * Every provider's effective chat settings, in priority order (lower first). Pure. Chat
 * overrides win, then the vision enable/priority (so nothing changes for deployments that
 * never visit the chat settings), then the registry default; the model is the admin's, else
 * the env var, else the adapter default.
 */
export function resolveChatProviders(cfg: ChatConfig): ChatProviderState[] {
  const vision = new Map(
    resolveVisionProviderConfig(cfg.visionRows, cfg.credentials).map((v) => [v.id, v]),
  );
  const chat = new Map(cfg.chatRows.map((r) => [r.provider, r]));
  return CHAT_PROVIDER_REGISTRY.map((d, i) => {
    const row = chat.get(d.id);
    const v = vision.get(d.id);
    const dbModel = row?.model?.trim() || null;
    const envModel = env(d.modelEnvVar) ?? null;
    const model = dbModel ?? envModel ?? d.defaultModel ?? null;
    return {
      id: d.id,
      label: d.label,
      configured: d.configured(cfg.credentials.get(d.id), model ?? undefined),
      enabled: row?.enabled ?? v?.enabled ?? true,
      enabledSource: row?.enabled != null ? ("chat" as const) : ("vision" as const),
      priority: row?.priority ?? v?.priority ?? 100 + i,
      prioritySource: row?.priority != null ? ("chat" as const) : ("vision" as const),
      model,
      modelSource: dbModel
        ? ("db" as const)
        : envModel
          ? ("env" as const)
          : d.defaultModel
            ? ("default" as const)
            : null,
    };
  }).sort((a, b) => a.priority - b.priority);
}

/**
 * The provider that answers chat, or null. A pin (admin setting, else `CHAT_PROVIDER`) is an
 * explicit operator choice, typically "keep data local": that provider or nothing — an
 * unusable pin makes chat unavailable rather than falling through to a (possibly cloud) one.
 * Without a pin, the first provider that is enabled and configured, by priority.
 */
export function selectChatProvider(
  states: ChatProviderState[],
  pin: string | null,
): ChatProviderState | null {
  if (pin) {
    const s = states.find((c) => c.id === pin);
    return s?.configured ? s : null;
  }
  return states.find((s) => s.enabled && s.configured) ?? null;
}

/** The effective pin and where it came from. */
export function effectivePin(cfg: Pick<ChatConfig, "pinned">) {
  if (cfg.pinned) return { value: cfg.pinned, source: "db" as const };
  const fromEnv = env("CHAT_PROVIDER")?.toLowerCase();
  return fromEnv ? { value: fromEnv, source: "env" as const } : { value: null, source: null };
}

export function buildChatProvider(
  state: ChatProviderState,
  credentials: Map<string, ResolvedSecret>,
): ChatProvider {
  const d = CHAT_PROVIDER_REGISTRY.find((c) => c.id === state.id)!;
  return d.create(credentials.get(d.id), state.model ?? undefined);
}

/**
 * Current chat configuration. Tests (and DB-less setups) use env-only selection, like the
 * vision factory, so there are no queries then.
 */
export async function loadChatConfig(): Promise<ChatConfig> {
  if (process.env.NODE_ENV === "test") {
    return { visionRows: [], chatRows: [], pinned: null, credentials: new Map() };
  }
  const db = getDb();
  const [visionRows, chatRows, settings, credentials] = await Promise.all([
    db
      .select({
        provider: visionProviderSettings.provider,
        enabled: visionProviderSettings.enabled,
        priority: visionProviderSettings.priority,
      })
      .from(visionProviderSettings),
    db
      .select({
        provider: chatProviderSettings.provider,
        enabled: chatProviderSettings.enabled,
        priority: chatProviderSettings.priority,
        model: chatProviderSettings.model,
      })
      .from(chatProviderSettings),
    db.select({ pinned: chatSettings.pinnedProvider }).from(chatSettings).limit(1),
    resolveVisionCredentials(),
  ]);
  return { visionRows, chatRows, pinned: settings[0]?.pinned ?? null, credentials };
}

/**
 * The provider that answers chat, or `null` when none is configured. Resolved per request
 * (a handful of tiny queries) so admin changes apply immediately.
 */
export async function getChatProvider(): Promise<ChatProvider | null> {
  const cfg = await loadChatConfig();
  const chosen = selectChatProvider(resolveChatProviders(cfg), effectivePin(cfg).value);
  return chosen ? buildChatProvider(chosen, cfg.credentials) : null;
}

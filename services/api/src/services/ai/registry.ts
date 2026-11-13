import type { ResolvedSecret } from "../market-data/types.js";
import { AnthropicChatProvider } from "../chat/anthropic.js";
import { GeminiChatProvider } from "../chat/gemini.js";
import { isLocalUrl } from "../chat/local-url.js";
import { OpenAICompatChatProvider } from "../chat/openai-compat.js";
import type { ChatProvider } from "../chat/types.js";
import { ClaudeVisionParser } from "../parsers/claude.js";
import { GeminiVisionParser } from "../parsers/gemini.js";
import { OllamaVisionParser } from "../parsers/ollama.js";
import { OpenRouterVisionParser } from "../parsers/openrouter.js";
import type { ScreenshotParser } from "../parsers/types.js";

export type AiTask = "vision" | "chat";
export const AI_TASKS: readonly AiTask[] = ["vision", "chat"];

export const env = (name: string) => process.env[name]?.trim() || undefined;

/** Options a chat provider is built with beyond credential and model. */
export interface ChatBuildOptions {
  /** Claude: `output_config.effort`. */
  effort?: string;
  /** OpenRouter: allow endpoints that may retain/train on prompts (default: deny). */
  allowDataCollection?: boolean;
}

/**
 * An AI provider: one connection (key or URL) shared by both tasks. The vision parsers and chat
 * adapters live in `services/parsers` and `services/chat`; this only wires credentials and a
 * model into them. Env vars are fallbacks for the credential and seed the first task setting
 * (see `seed.ts`), they do not select a provider at runtime.
 */
export interface AiProviderDescriptor {
  id: string;
  label: string;
  /** What the connection is: an API key, or (Ollama / LM Studio) a base URL. */
  credential: "key" | "url";
  /** Env var supplying the key/URL when no DB credential is stored. */
  credentialEnvVar: string;
  /**
   * A URL provider that can also carry an API key (an authenticated OpenAI-compatible server).
   * The key is optional; this is the env var it falls back to. Absent = the provider takes none.
   */
  optionalKeyEnvVar?: string;
  /**
   * false = never picked by the default vision/chat order (`deriveTask`): only an explicit
   * `SCREENSHOT_PARSER` / `CHAT_PROVIDER` pin or the admin selects it. For an endpoint that being
   * "configured" says nothing about (it can be any server, so it must not receive data unasked).
   */
  autoSelect?: boolean;
  /** Env var seeding the vision / chat model on first boot. */
  visionModelEnvVar: string;
  chatModelEnvVar: string;
  /** Used when a seeded setting has no model; chat has none for providers where it is a guess. */
  defaultVisionModel: string;
  defaultChatModel?: string;
  /** The provider has a usable credential (DB credential wins over the env var). */
  isConfigured: (secret?: ResolvedSecret) => boolean;
  /** Where requests go, for the "data stays local" check; null for fixed cloud endpoints. */
  baseUrl: (secret?: ResolvedSecret) => string | null;
  createVision: (secret: ResolvedSecret | undefined, model: string) => ScreenshotParser;
  createChat: (
    secret: ResolvedSecret | undefined,
    model: string,
    opts: ChatBuildOptions,
  ) => ChatProvider;
}

const key = (s: ResolvedSecret | undefined, envVar: string) => s?.apiKey ?? env(envVar) ?? "";
const urlFrom = (s: ResolvedSecret | undefined, envVar: string) =>
  (s?.url ?? env(envVar) ?? "").trim().replace(/\/+$/, "");
const url = (s: ResolvedSecret | undefined) => urlFrom(s, "OLLAMA_BASE_URL");

/** The server root of an OpenAI-compatible URL, whether or not it was entered with `/v1`. */
export const openAiRoot = (u: string) => u.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
/** The same URL as the `/v1` base the chat and models endpoints hang off. */
export const openAiV1 = (u: string) => (u.trim() ? `${openAiRoot(u)}/v1` : "");

export const compatUrl = (s: ResolvedSecret | undefined) => urlFrom(s, "OPENAI_COMPAT_BASE_URL");
// The env key belongs to the env URL: with a stored URL it is never sent there, so repointing
// the URL cannot hand a key to another host.
export const compatKey = (s: ResolvedSecret | undefined) =>
  s?.apiKey ?? (s?.url ? "" : (env("OPENAI_COMPAT_API_KEY") ?? ""));

/** In default order: the first configured one is what an env-only deployment gets. */
export const AI_PROVIDER_REGISTRY: AiProviderDescriptor[] = [
  {
    id: "claude",
    label: "Claude (Anthropic)",
    credential: "key",
    credentialEnvVar: "ANTHROPIC_API_KEY",
    visionModelEnvVar: "ANTHROPIC_VISION_MODEL",
    chatModelEnvVar: "ANTHROPIC_CHAT_MODEL",
    defaultVisionModel: "claude-sonnet-4-6",
    defaultChatModel: "claude-opus-5-5",
    isConfigured: (s) => Boolean(key(s, "ANTHROPIC_API_KEY")),
    baseUrl: () => null,
    createVision: (s, model) => new ClaudeVisionParser(key(s, "ANTHROPIC_API_KEY"), { model }),
    createChat: (s, model, o) =>
      new AnthropicChatProvider(key(s, "ANTHROPIC_API_KEY"), { model, effort: o.effort }),
  },
  {
    id: "gemini",
    label: "Gemini (Google)",
    credential: "key",
    credentialEnvVar: "GEMINI_API_KEY",
    visionModelEnvVar: "GEMINI_VISION_MODEL",
    chatModelEnvVar: "GEMINI_CHAT_MODEL",
    defaultVisionModel: "gemini-2.5-flash",
    isConfigured: (s) => Boolean(key(s, "GEMINI_API_KEY")),
    baseUrl: () => null,
    createVision: (s, model) => new GeminiVisionParser(key(s, "GEMINI_API_KEY"), { model }),
    createChat: (s, model) => new GeminiChatProvider(key(s, "GEMINI_API_KEY"), { model }),
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    credential: "key",
    credentialEnvVar: "OPENROUTER_API_KEY",
    visionModelEnvVar: "OPENROUTER_VISION_MODEL",
    chatModelEnvVar: "OPENROUTER_CHAT_MODEL",
    defaultVisionModel: "google/gemini-2.5-flash",
    isConfigured: (s) => Boolean(key(s, "OPENROUTER_API_KEY")),
    baseUrl: () => null,
    createVision: (s, model) => new OpenRouterVisionParser(key(s, "OPENROUTER_API_KEY"), { model }),
    createChat: (s, model, o) =>
      new OpenAICompatChatProvider({
        name: "openrouter",
        label: "OpenRouter",
        local: false,
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: key(s, "OPENROUTER_API_KEY") || undefined,
        model,
        // Financial data: only route to providers that don't retain/train on prompts, unless the
        // operator opts out (some models have no such endpoint).
        extraBody: o.allowDataCollection ? undefined : { provider: { data_collection: "deny" } },
      }),
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    credential: "url",
    credentialEnvVar: "OLLAMA_BASE_URL",
    visionModelEnvVar: "OLLAMA_VISION_MODEL",
    chatModelEnvVar: "OLLAMA_CHAT_MODEL",
    defaultVisionModel: "qwen2.5vl:7b",
    // The localhost default is not "configured": we don't know a local Ollama is running.
    isConfigured: (s) => Boolean(url(s)),
    baseUrl: (s) => url(s) || null,
    createVision: (s, model) => new OllamaVisionParser({ baseUrl: url(s), model }),
    createChat: (s, model) =>
      new OpenAICompatChatProvider({
        name: "ollama",
        label: "Ollama (local)",
        // The URL may be remote (e.g. an admin override), so don't assume.
        local: isLocalUrl(url(s)),
        baseUrl: `${url(s)}/v1`,
        model,
      }),
  },
  {
    // LM Studio, vLLM, llama.cpp, LocalAI, a LiteLLM proxy: any server speaking the OpenAI dialect.
    id: "openai-compatible",
    label: "OpenAI-compatible",
    credential: "url",
    credentialEnvVar: "OPENAI_COMPAT_BASE_URL",
    optionalKeyEnvVar: "OPENAI_COMPAT_API_KEY",
    autoSelect: false,
    visionModelEnvVar: "OPENAI_COMPAT_VISION_MODEL",
    chatModelEnvVar: "OPENAI_COMPAT_CHAT_MODEL",
    // No default: which models a server has loaded is up to it, so a model must be chosen.
    defaultVisionModel: "",
    isConfigured: (s) => Boolean(compatUrl(s)),
    baseUrl: (s) => compatUrl(s) || null,
    createVision: (s, model) =>
      new OllamaVisionParser({
        name: "openai-compatible",
        baseUrl: openAiRoot(compatUrl(s)),
        apiKey: compatKey(s) || undefined,
        model,
      }),
    createChat: (s, model) =>
      new OpenAICompatChatProvider({
        name: "openai-compatible",
        label: "OpenAI-compatible",
        local: isLocalUrl(compatUrl(s)),
        baseUrl: openAiV1(compatUrl(s)),
        apiKey: compatKey(s) || undefined,
        model,
      }),
  },
];

export const findProvider = (id: string | null | undefined) =>
  id ? AI_PROVIDER_REGISTRY.find((d) => d.id === id) : undefined;

/** Whether this provider's endpoint is on the operator's own network (Ollama or an OpenAI-compatible server). */
export function isLocalProvider(d: AiProviderDescriptor, secret?: ResolvedSecret): boolean | null {
  const base = d.baseUrl(secret);
  return base === null ? null : isLocalUrl(base);
}

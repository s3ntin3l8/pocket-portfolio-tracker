import type { ResolvedSecret } from "../market-data/types.js";
import { AI_PROVIDER_REGISTRY, env, findProvider, type AiProviderDescriptor } from "./registry.js";
import type { AiTask } from "./registry.js";

/** One task's choice: a provider (null = off) and the model it runs. */
export interface TaskSetting {
  provider: string | null;
  model: string | null;
  /** Claude chat only. */
  effort: string | null;
}

export const OFF: TaskSetting = { provider: null, model: null, effort: null };

export const visionModel = (d: AiProviderDescriptor) =>
  env(d.visionModelEnvVar) ?? d.defaultVisionModel;

/**
 * What a task selects from env: the pin if set, else the first configured provider in registry
 * order. Pure apart from reading env. Only `seedAiTaskSettings` persists it; at runtime a task with no stored setting is off
 * (`AiConfig.envFallback`), except under test, which has no DB and uses this directly.
 *
 * Rules:
 * - vision: `SCREENSHOT_PARSER` pin, else first configured;
 * - chat: `CHAT_PROVIDER` pin: that provider or nothing, never a fall-through.
 *   Without a pin, a provider only counts once it has a chat model (the vision models are no
 *   good for tool calling), so a Gemini vision key never starts answering chat.
 */
export function deriveTask(task: AiTask, credentials: Map<string, ResolvedSecret>): TaskSetting {
  if (task === "vision") {
    const pin = env("SCREENSHOT_PARSER")?.toLowerCase();
    const pinned = findProvider(pin);
    if (pinned) return { provider: pinned.id, model: visionModel(pinned), effort: null };
    const first = AI_PROVIDER_REGISTRY.find((d) => d.isConfigured(credentials.get(d.id)));
    return first ? { provider: first.id, model: visionModel(first), effort: null } : OFF;
  }

  const chatModel = (d: AiProviderDescriptor) =>
    env(d.chatModelEnvVar) || d.defaultChatModel || null;
  const setting = (d: AiProviderDescriptor): TaskSetting => ({
    provider: d.id,
    model: chatModel(d),
    effort: d.id === "claude" ? (env("ANTHROPIC_CHAT_EFFORT") ?? null) : null,
  });

  const pin = env("CHAT_PROVIDER")?.toLowerCase();
  if (pin) {
    const pinned = findProvider(pin);
    return pinned ? setting(pinned) : OFF;
  }
  const first = AI_PROVIDER_REGISTRY.find(
    (d) => d.isConfigured(credentials.get(d.id)) && Boolean(chatModel(d)),
  );
  return first ? setting(first) : OFF;
}

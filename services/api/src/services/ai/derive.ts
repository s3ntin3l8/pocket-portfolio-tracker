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

/**
 * The pre-`ai_task_settings` admin state: the vision enable/priority list, the chat overrides
 * and the chat pin. Read only to seed the new settings on first boot, so an upgrade keeps
 * whatever the old selection resolved to.
 */
export interface LegacyRows {
  vision: { provider: string; enabled: boolean; priority: number }[];
  chat: {
    provider: string;
    enabled: boolean | null;
    priority: number | null;
    model: string | null;
  }[];
  pinned: string | null;
}
export const NO_LEGACY: LegacyRows = { vision: [], chat: [], pinned: null };

export const visionModel = (d: AiProviderDescriptor) =>
  env(d.visionModelEnvVar) ?? d.defaultVisionModel;

/**
 * What a task selects from env (and, when seeding, the legacy admin state): the pin if set, else
 * the first enabled + configured provider in (legacy) priority order. Pure apart from reading
 * env. Only `seedAiTaskSettings` persists it; at runtime a task with no stored setting is off
 * (`AiConfig.envFallback`), except under test, which has no DB and uses this directly.
 *
 * Unchanged from the old selection on purpose, so nothing goes live on upgrade:
 * - vision: `SCREENSHOT_PARSER` pin (used even if the admin disabled it), else first configured;
 * - chat: the admin pin, else `CHAT_PROVIDER`: that provider or nothing, never a fall-through.
 *   Without a pin, a provider only counts once it has a chat model (the vision models are no
 *   good for tool calling), so a Gemini vision key never starts answering chat.
 */
export function deriveTask(
  task: AiTask,
  credentials: Map<string, ResolvedSecret>,
  legacy: LegacyRows = NO_LEGACY,
): TaskSetting {
  const visionRows = new Map(legacy.vision.map((r) => [r.provider, r]));
  const chatRows = new Map(legacy.chat.map((r) => [r.provider, r]));

  const ordered = (priority: (d: AiProviderDescriptor, i: number) => number) =>
    AI_PROVIDER_REGISTRY.map((d, i) => ({ d, p: priority(d, i) }))
      .sort((a, b) => a.p - b.p)
      .map((x) => x.d);

  if (task === "vision") {
    const pin = env("SCREENSHOT_PARSER")?.toLowerCase();
    const pinned = findProvider(pin);
    if (pinned) return { provider: pinned.id, model: visionModel(pinned), effort: null };
    const first = ordered((d, i) => visionRows.get(d.id)?.priority ?? i + 1).find(
      (d) => (visionRows.get(d.id)?.enabled ?? true) && d.isConfigured(credentials.get(d.id)),
    );
    return first ? { provider: first.id, model: visionModel(first), effort: null } : OFF;
  }

  const chatModel = (d: AiProviderDescriptor) =>
    chatRows.get(d.id)?.model?.trim() || env(d.chatModelEnvVar) || d.defaultChatModel || null;
  const setting = (d: AiProviderDescriptor): TaskSetting => ({
    provider: d.id,
    model: chatModel(d),
    effort: d.id === "claude" ? (env("ANTHROPIC_CHAT_EFFORT") ?? null) : null,
  });

  const pin = legacy.pinned ?? env("CHAT_PROVIDER")?.toLowerCase();
  if (pin) {
    const pinned = findProvider(pin);
    return pinned ? setting(pinned) : OFF;
  }
  const first = ordered(
    (d, i) => chatRows.get(d.id)?.priority ?? visionRows.get(d.id)?.priority ?? i + 1,
  ).find(
    (d) =>
      (chatRows.get(d.id)?.enabled ?? visionRows.get(d.id)?.enabled ?? true) &&
      d.isConfigured(credentials.get(d.id)) &&
      Boolean(chatModel(d)),
  );
  return first ? setting(first) : OFF;
}

import {
  aiProviderSettings,
  aiTaskSettings,
  chatProviderSettings,
  chatSettings,
  visionProviderSettings,
} from "@portfolio/db";
import type { DB } from "../../db/client.js";
import { deriveTask, type LegacyRows } from "./derive.js";
import { AI_TASKS, env } from "./registry.js";
import { resolveAiCredentials } from "./resolve.js";

/**
 * Persist today's effective provider + model for every AI task that has no stored setting, so
 * an upgrade changes nothing and later env edits stop silently moving the selection. Runs at
 * startup; a task with nothing selectable gets no row, so a later boot that has a key seeds it.
 * Never overwrites a stored row (an explicit "off" is a row with a null provider).
 *
 * Reads the legacy vision/chat tables, which are kept one release for exactly this.
 */
export async function seedAiTaskSettings(db: DB): Promise<{ seeded: string[] }> {
  const [existing, visionRows, chatRows, pinRows, credentials, optionRows] = await Promise.all([
    db.select({ task: aiTaskSettings.task }).from(aiTaskSettings),
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
    resolveAiCredentials(),
    db.select({ provider: aiProviderSettings.provider }).from(aiProviderSettings),
  ]);
  const legacy: LegacyRows = {
    vision: visionRows,
    chat: chatRows,
    pinned: pinRows[0]?.pinned ?? null,
  };
  const have = new Set(existing.map((r) => r.task));

  const seeded: string[] = [];
  for (const task of AI_TASKS) {
    if (have.has(task)) continue;
    const s = deriveTask(task, credentials, legacy);
    if (!s.provider) {
      // The old admin settings (a provider switched off, a pin to something unusable) are what
      // kept env from selecting one. Store that as an explicit "off", so it holds once those
      // tables are dropped and the seed no longer sees them.
      if (deriveTask(task, credentials).provider) {
        await db.insert(aiTaskSettings).values({ task, provider: null }).onConflictDoNothing();
        seeded.push(task);
      }
      continue;
    }
    await db
      .insert(aiTaskSettings)
      .values({ task, provider: s.provider, model: s.model, effort: s.effort })
      .onConflictDoNothing();
    seeded.push(task);
  }

  if (
    env("OPENROUTER_ALLOW_DATA_COLLECTION") === "true" &&
    !optionRows.some((r) => r.provider === "openrouter")
  ) {
    await db
      .insert(aiProviderSettings)
      .values({ provider: "openrouter", allowDataCollection: true })
      .onConflictDoNothing();
  }
  return { seeded };
}

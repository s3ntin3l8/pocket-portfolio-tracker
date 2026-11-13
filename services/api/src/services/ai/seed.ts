import { aiProviderSettings, aiTaskSettings } from "@portfolio/db";
import type { DB } from "../../db/client.js";
import { deriveTask } from "./derive.js";
import { AI_TASKS, env } from "./registry.js";
import { resolveAiCredentials } from "./resolve.js";

/**
 * Persist the env-derived provider + model for every AI task that has no stored setting, so
 * later env edits stop silently moving the selection. Runs at startup; a task with nothing
 * selectable gets no row, so a later boot that has a key seeds it. Never overwrites a stored
 * row (an explicit "off" is a row with a null provider).
 */
export async function seedAiTaskSettings(db: DB): Promise<{ seeded: string[] }> {
  const [existing, credentials, optionRows] = await Promise.all([
    db.select({ task: aiTaskSettings.task }).from(aiTaskSettings),
    resolveAiCredentials(),
    db.select({ provider: aiProviderSettings.provider }).from(aiProviderSettings),
  ]);
  const have = new Set(existing.map((r) => r.task));

  const seeded: string[] = [];
  for (const task of AI_TASKS) {
    if (have.has(task)) continue;
    const s = deriveTask(task, credentials);
    if (!s.provider) continue;
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

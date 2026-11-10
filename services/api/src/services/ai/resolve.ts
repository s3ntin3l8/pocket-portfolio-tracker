import { aiProviderSettings, aiTaskSettings, providerCredentials } from "@portfolio/db";
import { getDb, getEncryption } from "../../db/client.js";
import type { ChatProvider } from "../chat/types.js";
import type { ResolvedSecret } from "../market-data/types.js";
import { ClaudeVisionParser } from "../parsers/claude.js";
import type { ScreenshotParser } from "../parsers/types.js";
import { deriveTask, OFF, type TaskSetting } from "./derive.js";
import { AI_TASKS, env, findProvider, type AiTask } from "./registry.js";

/** `provider_credentials` rows of the AI providers are stored as `ai:<provider id>`. */
export const AI_CREDENTIAL_PREFIX = "ai:";

export interface AiConfig {
  /** The admin's stored settings. */
  tasks: Map<AiTask, TaskSetting>;
  /**
   * A task with no stored row is off, never derived from env: only `seedAiTaskSettings` (which
   * also sees the legacy admin switches and pin) may turn env into a selection. If the seed
   * failed, or the legacy state resolved to "off", env must not quietly switch a provider on.
   * Under test there is no DB, so the env-derived choice stands in for the seed.
   */
  envFallback: boolean;
  credentials: Map<string, ResolvedSecret>;
  /** OpenRouter: the admin's data-collection switch (absent / null = default). */
  allowDataCollection: Map<string, boolean | null>;
}

/**
 * Fetch and decrypt the stored provider credentials. A DB key/URL wins over the env fallback
 * (applied by the descriptors); a row that fails to decrypt is skipped so env can take over.
 */
export async function resolveAiCredentials(): Promise<Map<string, ResolvedSecret>> {
  const enc = getEncryption();
  const rows = await getDb()
    .select()
    .from(providerCredentials)
    .then((rs) => rs.filter((r) => r.provider.startsWith(AI_CREDENTIAL_PREFIX)));

  const out = new Map<string, ResolvedSecret>();
  for (const row of rows) {
    const secret: ResolvedSecret = {};
    if (row.apiKeyEnc) {
      try {
        secret.apiKey = enc.decryptString(row.apiKeyEnc);
      } catch {
        // Decryption failure: skip the key; the env var acts as fallback.
      }
    }
    if (row.urlOverride) secret.url = row.urlOverride;
    if (secret.apiKey !== undefined || secret.url !== undefined) {
      out.set(row.provider.slice(AI_CREDENTIAL_PREFIX.length), secret);
    }
  }
  return out;
}

/**
 * The current AI configuration. Tests (and DB-less setups) use env-only selection, so there are
 * no queries then; a test that needs the DB layer sets NODE_ENV to something else.
 */
export async function loadAiConfig(): Promise<AiConfig> {
  if (process.env.NODE_ENV === "test") {
    return {
      tasks: new Map(),
      envFallback: true,
      credentials: new Map(),
      allowDataCollection: new Map(),
    };
  }
  const db = getDb();
  const [taskRows, providerRows, credentials] = await Promise.all([
    db.select().from(aiTaskSettings),
    db.select().from(aiProviderSettings),
    resolveAiCredentials(),
  ]);
  const tasks = new Map<AiTask, TaskSetting>();
  for (const r of taskRows) {
    if ((AI_TASKS as readonly string[]).includes(r.task)) {
      tasks.set(r.task as AiTask, { provider: r.provider, model: r.model, effort: r.effort });
    }
  }
  return {
    tasks,
    envFallback: false,
    credentials,
    allowDataCollection: new Map(providerRows.map((r) => [r.provider, r.allowDataCollection])),
  };
}

export interface ResolvedTask extends TaskSetting {
  task: AiTask;
  /** Runnable now: a known provider with a credential and a model. */
  usable: boolean;
}

export function resolveTask(task: AiTask, cfg: AiConfig): ResolvedTask {
  const stored = cfg.tasks.get(task);
  const setting = stored ?? (cfg.envFallback ? deriveTask(task, cfg.credentials) : OFF);
  const d = findProvider(setting.provider);
  return {
    task,
    ...setting,
    usable: Boolean(d && setting.model && d.isConfigured(cfg.credentials.get(d.id))),
  };
}

/** OpenRouter's data-collection switch: the admin's, else the env var. */
export function allowsDataCollection(cfg: AiConfig, provider: string): boolean {
  return (
    cfg.allowDataCollection.get(provider) ?? env("OPENROUTER_ALLOW_DATA_COLLECTION") === "true"
  );
}

/**
 * The parser for the vision task, built per call (a few tiny queries per upload) so an admin
 * change applies immediately, without a restart. A task that is off or has no model gets an
 * inert parser: `isConfigured()` is false and the import route answers 503.
 */
export async function resolveScreenshotParser(): Promise<ScreenshotParser> {
  const cfg = await loadAiConfig();
  const t = resolveTask("vision", cfg);
  const d = findProvider(t.provider);
  if (!d || !t.model) return new ClaudeVisionParser("", {});
  return d.createVision(cfg.credentials.get(d.id), t.model);
}

/** The provider that answers chat, or null when chat is off or not usable. */
export async function getChatProvider(): Promise<ChatProvider | null> {
  const cfg = await loadAiConfig();
  const t = resolveTask("chat", cfg);
  const d = findProvider(t.provider);
  if (!d || !t.model || !t.usable) return null;
  return d.createChat(cfg.credentials.get(d.id), t.model, {
    effort: t.effort ?? undefined,
    allowDataCollection: allowsDataCollection(cfg, d.id),
  });
}

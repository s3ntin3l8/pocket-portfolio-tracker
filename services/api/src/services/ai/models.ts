import { createHmac, randomBytes } from "node:crypto";
import type { ResolvedSecret } from "../market-data/types.js";
import { compatKey, env, findProvider, openAiV1, type AiTask } from "./registry.js";

/** One selectable model. A null capability means the provider's API doesn't say. */
export interface AiModel {
  id: string;
  label: string;
  vision: boolean | null;
  tools: boolean | null;
}

export interface AiModelList {
  models: AiModel[];
  /** A code, never the upstream body (it can echo credentials/prompts). Models are then empty. */
  error?: string;
}

const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_PAGES = 10;

type Fetch = typeof fetch;

class ListError extends Error {}

async function getJson(
  doFetch: Fetch,
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await doFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new ListError("provider_unreachable");
  }
  if (!res.ok) throw new ListError(`provider_http_${res.status}`);
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw new ListError("provider_bad_response");
  }
}

const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    : [];
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const strs = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;

async function listClaude(doFetch: Fetch, apiKey: string): Promise<AiModel[]> {
  const out: AiModel[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ limit: "1000", ...(after ? { after_id: after } : {}) });
    const json = await getJson(doFetch, `https://api.anthropic.com/v1/models?${q}`, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    for (const m of rows(json.data)) {
      const id = str(m.id);
      if (!id) continue;
      const caps = m.capabilities as { image_input?: { supported?: unknown } } | undefined;
      const image = caps?.image_input?.supported;
      out.push({
        id,
        label: str(m.display_name) ?? id,
        vision: typeof image === "boolean" ? image : null,
        // Every Claude model supports tool use.
        tools: true,
      });
    }
    after = str(json.last_id);
    if (json.has_more !== true || !after) break;
  }
  return out;
}

async function listOpenRouter(doFetch: Fetch, apiKey: string): Promise<AiModel[]> {
  const json = await getJson(doFetch, "https://openrouter.ai/api/v1/models", {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  });
  return rows(json.data).flatMap((m) => {
    const id = str(m.id);
    if (!id) return [];
    const modalities = strs(
      (m.architecture as { input_modalities?: unknown } | undefined)?.input_modalities,
    );
    const params = strs(m.supported_parameters);
    return [
      {
        id,
        label: str(m.name) ?? id,
        vision: modalities ? modalities.includes("image") : null,
        tools: params ? params.includes("tools") : null,
      },
    ];
  });
}

async function listGemini(doFetch: Fetch, apiKey: string): Promise<AiModel[]> {
  const out: AiModel[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ pageSize: "1000", ...(token ? { pageToken: token } : {}) });
    const json = await getJson(
      doFetch,
      `https://generativelanguage.googleapis.com/v1beta/models?${q}`,
      { headers: { "x-goog-api-key": apiKey } },
    );
    for (const m of rows(json.models)) {
      const name = str(m.name)?.replace(/^models\//, "");
      // Embedding / AQA / imagen models can't be used for either task.
      if (!name || !strs(m.supportedGenerationMethods)?.includes("generateContent")) continue;
      // The API doesn't expose input modalities or tool support.
      out.push({ id: name, label: str(m.displayName) ?? name, vision: null, tools: null });
    }
    token = str(json.nextPageToken);
    if (!token) break;
  }
  return out;
}

async function listOllama(doFetch: Fetch, baseUrl: string): Promise<AiModel[]> {
  const base = baseUrl.replace(/\/+$/, "");
  const json = await getJson(doFetch, `${base}/api/tags`);
  const names = rows(json.models).flatMap((m) => {
    const n = str(m.name) ?? str(m.model);
    return n ? [n] : [];
  });
  // `/api/show` reports capabilities on recent Ollama; older servers (or a failure) leave them unknown.
  return Promise.all(
    names.map(async (id): Promise<AiModel> => {
      try {
        const info = await getJson(doFetch, `${base}/api/show`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: id }),
        });
        const caps = strs(info.capabilities);
        return {
          id,
          label: id,
          vision: caps ? caps.includes("vision") : null,
          tools: caps ? caps.includes("tools") : null,
        };
      } catch {
        return { id, label: id, vision: null, tools: null };
      }
    }),
  );
}

/** `GET {base}/v1/models` of an OpenAI-compatible server; it reports no capabilities. */
async function listOpenAICompat(
  doFetch: Fetch,
  baseUrl: string,
  apiKey: string,
): Promise<AiModel[]> {
  const json = await getJson(doFetch, `${openAiV1(baseUrl)}/models`, {
    headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
  });
  return rows(json.data).flatMap((m) => {
    const id = str(m.id);
    return id ? [{ id, label: id, vision: null, tools: null }] : [];
  });
}

/** Random per process: makes the cache identity of a key unguessable and unreproducible elsewhere. */
const CACHE_ID_SECRET = randomBytes(32);

const cache = new Map<string, { at: number; models: AiModel[] }>();

/** Drop cached model lists (all, or one provider's) — e.g. after its credential changed. */
export function clearModelCache(provider?: string) {
  if (!provider) return cache.clear();
  for (const k of cache.keys()) if (k.startsWith(`${provider}|`)) cache.delete(k);
}

/**
 * The provider's models for a task, from its own API. Models the API says can't do the task are
 * dropped (no image input for vision, no tool use for chat); ones it doesn't say stay, marked
 * unknown. Provider failures come back as `error`, so the UI can fall back to typing a model id.
 */
export async function listModels(
  provider: string,
  task: AiTask,
  secret: ResolvedSecret | undefined,
  opts: { fetch?: Fetch; now?: number } = {},
): Promise<AiModelList> {
  const d = findProvider(provider);
  if (!d) return { models: [], error: "unknown_provider" };
  if (!d.isConfigured(secret)) return { models: [], error: "provider_not_configured" };

  const doFetch = opts.fetch ?? globalThis.fetch;
  const now = opts.now ?? Date.now();
  // A URL provider's `credentialEnvVar` is the URL, not a key. The one with an optional key
  // resolves it in the registry (`compatKey`), the single owner of which key may go to which URL.
  const apiKey =
    d.credential === "key"
      ? (secret?.apiKey ?? env(d.credentialEnvVar) ?? "")
      : d.optionalKeyEnvVar
        ? compatKey(secret)
        : "";
  const baseUrl = d.baseUrl(secret) ?? "";
  // Keyed by credential so a changed key/URL never serves the previous account's list.
  // The key is never held in plaintext by the process-lifetime cache: only a keyed digest (HMAC
  // under a per-process random secret) identifies it. This is a cache identity, not password
  // storage, and the secret never leaves the process.
  const keyId = createHmac("sha256", CACHE_ID_SECRET).update(apiKey).digest("hex").slice(0, 16);
  const cacheKey = `${provider}|${d.credential === "url" ? `${baseUrl}|${keyId}` : keyId}`;

  let all = cache.get(cacheKey);
  if (!all || now - all.at > CACHE_TTL_MS) {
    try {
      let models: AiModel[];
      switch (provider) {
        case "claude":
          models = await listClaude(doFetch, apiKey);
          break;
        case "gemini":
          models = await listGemini(doFetch, apiKey);
          break;
        case "openrouter":
          models = await listOpenRouter(doFetch, apiKey);
          break;
        case "ollama":
          models = await listOllama(doFetch, baseUrl);
          break;
        case "openai-compatible":
          models = await listOpenAICompat(doFetch, baseUrl, apiKey);
          break;
        default:
          return { models: [], error: "unknown_provider" };
      }
      all = { at: now, models };
      cache.set(cacheKey, all);
    } catch (err) {
      return { models: [], error: err instanceof ListError ? err.message : "provider_error" };
    }
  }
  const models = all.models
    .filter((m) => (task === "vision" ? m.vision !== false : m.tools !== false))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { models };
}

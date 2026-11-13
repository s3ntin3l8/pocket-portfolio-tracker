import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearModelCache, listModels } from "../../../src/services/ai/models.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetch that answers by URL substring and records every call. */
function fakeFetch(routes: Record<string, (init?: RequestInit) => Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected ${url}`);
    return routes[key]!(init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

beforeEach(() => {
  clearModelCache();
  for (const k of [
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "OLLAMA_BASE_URL",
    "OPENAI_COMPAT_BASE_URL",
    "OPENAI_COMPAT_API_KEY",
  ])
    vi.stubEnv(k, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("listModels", () => {
  it("rejects an unknown or unconfigured provider without calling out", async () => {
    const { f, calls } = fakeFetch({});
    expect(await listModels("nope", "chat", undefined, { fetch: f })).toEqual({
      models: [],
      error: "unknown_provider",
    });
    expect(await listModels("claude", "chat", undefined, { fetch: f })).toEqual({
      models: [],
      error: "provider_not_configured",
    });
    expect(calls).toHaveLength(0);
  });

  it("Claude: maps display names, reads image_input, paginates, sends the key", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let n = 0;
    const paged = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return n++ === 0
        ? json({
            data: [
              {
                id: "claude-b",
                display_name: "Claude B",
                capabilities: { image_input: { supported: true } },
              },
              {
                id: "claude-text",
                display_name: "Text Only",
                capabilities: { image_input: { supported: false } },
              },
            ],
            has_more: true,
            last_id: "claude-text",
          })
        : json({ data: [{ id: "claude-a", display_name: "Claude A" }], has_more: false });
    }) as unknown as typeof fetch;

    const vision = await listModels("claude", "vision", { apiKey: "sk-test" }, { fetch: paged }); // pragma: allowlist secret
    expect(vision.models.map((m) => m.id)).toEqual(["claude-a", "claude-b"]); // text-only dropped
    expect(vision.models[0]).toMatchObject({ vision: null, tools: true }); // capability not stated
    expect(calls[1]!.url).toContain("after_id=claude-text");
    expect((calls[0]!.init!.headers as Record<string, string>)["x-api-key"]).toBe("sk-test");
  });

  it("OpenRouter: filters by input modality for vision and by tools for chat", async () => {
    const { f } = fakeFetch({
      "openrouter.ai/api/v1/models": () =>
        json({
          data: [
            {
              id: "a/vision-tools",
              name: "VT",
              architecture: { input_modalities: ["text", "image"] },
              supported_parameters: ["tools"],
            },
            {
              id: "b/text-tools",
              name: "TT",
              architecture: { input_modalities: ["text"] },
              supported_parameters: ["tools"],
            },
            {
              id: "c/vision-only",
              name: "VO",
              architecture: { input_modalities: ["image"] },
              supported_parameters: ["temperature"],
            },
            { id: "d/unknown", name: "UN" },
          ],
        }),
    });
    const secret = { apiKey: "k" }; // pragma: allowlist secret
    const vision = await listModels("openrouter", "vision", secret, { fetch: f });
    expect(new Set(vision.models.map((m) => m.id))).toEqual(
      new Set(["a/vision-tools", "c/vision-only", "d/unknown"]),
    );
    const chat = await listModels("openrouter", "chat", secret, { fetch: f });
    expect(new Set(chat.models.map((m) => m.id))).toEqual(
      new Set(["a/vision-tools", "b/text-tools", "d/unknown"]),
    );
  });

  it("Gemini: keeps generateContent models, strips the models/ prefix, leaves capabilities unknown", async () => {
    const { f } = fakeFetch({
      "generativelanguage.googleapis.com": () =>
        json({
          models: [
            {
              name: "models/gemini-2.5-pro",
              displayName: "Gemini 2.5 Pro",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/text-embedding-004",
              displayName: "Embedding",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        }),
    });
    const r = await listModels("gemini", "chat", { apiKey: "g" }, { fetch: f }); // pragma: allowlist secret
    expect(r.models).toEqual([
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", vision: null, tools: null },
    ]);
  });

  it("Ollama: reads capabilities from /api/show and tolerates a failing or older server", async () => {
    const { f } = fakeFetch({
      "/api/tags": () => json({ models: [{ name: "llava" }, { name: "qwen3" }, { name: "old" }] }),
      "/api/show": (init) => {
        const model = JSON.parse(String(init!.body)).model;
        if (model === "llava") return json({ capabilities: ["completion", "vision"] });
        if (model === "qwen3") return json({ capabilities: ["completion", "tools"] });
        return json({ error: "x" }, 500);
      },
    });
    const secret = { url: "http://ollama:11434/" };
    const vision = await listModels("ollama", "vision", secret, { fetch: f });
    expect(vision.models.map((m) => m.id)).toEqual(["llava", "old"]); // qwen3 has no vision
    const chat = await listModels("ollama", "chat", secret, { fetch: f });
    expect(chat.models.map((m) => m.id)).toEqual(["old", "qwen3"]); // llava has no tools
  });

  it("OpenAI-compatible: lists /v1/models (ids only, capabilities unknown), with or without /v1", async () => {
    const { f, calls } = fakeFetch({
      "/v1/models": () =>
        json({ data: [{ id: "qwen2.5-vl" }, { id: "llama-3" }, { object: "x" }] }),
    });
    const r = await listModels(
      "openai-compatible",
      "vision",
      { url: "http://lm:1234/" },
      { fetch: f },
    );
    expect(r.models).toEqual([
      { id: "llama-3", label: "llama-3", vision: null, tools: null },
      { id: "qwen2.5-vl", label: "qwen2.5-vl", vision: null, tools: null },
    ]);
    expect(calls[0]!.url).toBe("http://lm:1234/v1/models");
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBeNull();

    clearModelCache();
    await listModels("openai-compatible", "chat", { url: "http://lm:1234/v1" }, { fetch: f });
    expect(calls[1]!.url).toBe("http://lm:1234/v1/models");
  });

  it("OpenAI-compatible: sends the stored or env key as a Bearer token; a credential change clears the cache", async () => {
    const { f, calls } = fakeFetch({ "/v1/models": () => json({ data: [{ id: "m" }] }) });
    await listModels(
      "openai-compatible",
      "chat",
      { url: "http://lm:1234", apiKey: "k1" }, // pragma: allowlist secret
      { fetch: f },
    ); // pragma: allowlist secret
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer k1");

    vi.stubEnv("OPENAI_COMPAT_BASE_URL", "http://lm:1234");
    vi.stubEnv("OPENAI_COMPAT_API_KEY", "env-key"); // pragma: allowlist secret
    // Same URL: served from the cache (the key is not part of it)...
    await listModels("openai-compatible", "chat", undefined, { fetch: f });
    expect(calls).toHaveLength(1);
    // ...until the credential changes, which the admin routes signal with clearModelCache.
    clearModelCache("openai-compatible");
    await listModels("openai-compatible", "chat", undefined, { fetch: f });
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[1]!.init?.headers).get("authorization")).toBe("Bearer env-key");
  });

  it("OpenAI-compatible: the env key is not sent to a stored URL", async () => {
    vi.stubEnv("OPENAI_COMPAT_API_KEY", "env-key"); // pragma: allowlist secret
    const { f, calls } = fakeFetch({ "/v1/models": () => json({ data: [] }) });
    await listModels("openai-compatible", "chat", { url: "http://other:1234" }, { fetch: f });
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBeNull();
  });

  it("OpenAI-compatible: needs a URL, and a failure is a code", async () => {
    const { f, calls } = fakeFetch({});
    expect(await listModels("openai-compatible", "chat", { apiKey: "k" }, { fetch: f })).toEqual({
      // pragma: allowlist secret
      models: [],
      error: "provider_not_configured",
    });
    expect(calls).toHaveLength(0);
    const down = (async () => json({}, 503)) as unknown as typeof fetch;
    expect(
      (await listModels("openai-compatible", "chat", { url: "http://lm:1234" }, { fetch: down }))
        .error,
    ).toBe("provider_http_503");
  });

  it("reports a provider failure as a code, not the upstream body", async () => {
    const down = (async () =>
      json({ error: { message: "secret echoed sk-test" } }, 401)) as unknown as typeof fetch;
    const r = await listModels("claude", "chat", { apiKey: "sk-test" }, { fetch: down }); // pragma: allowlist secret
    expect(r).toEqual({ models: [], error: "provider_http_401" });

    const unreachable = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(
      (await listModels("openrouter", "chat", { apiKey: "k2" }, { fetch: unreachable })).error, // pragma: allowlist secret
    ).toBe("provider_unreachable");
  });

  it("caches per provider for ten minutes, re-fetches after, and drops the entry when the credential changes", async () => {
    let n = 0;
    const f = (async () => {
      n++;
      return json({ data: [{ id: "m", name: "M" }] });
    }) as unknown as typeof fetch;
    const secret = { apiKey: "key-1" }; // pragma: allowlist secret
    const t0 = 1_000_000;
    await listModels("openrouter", "chat", secret, { fetch: f, now: t0 });
    await listModels("openrouter", "vision", secret, { fetch: f, now: t0 + 60_000 });
    expect(n).toBe(1); // both tasks share one upstream list
    // The key is not part of the cache (nothing secret is held): a credential change is signalled
    // by the admin routes with clearModelCache, which drops the entry so the next call re-fetches.
    clearModelCache("openrouter");
    await listModels("openrouter", "chat", { apiKey: "key-2" }, { fetch: f, now: t0 + 60_000 }); // pragma: allowlist secret
    expect(n).toBe(2);
    await listModels("openrouter", "chat", secret, { fetch: f, now: t0 + 12 * 60_000 });
    expect(n).toBe(3); // past the ten minutes
  });
});

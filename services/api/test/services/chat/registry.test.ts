import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_PROVIDER_REGISTRY, getChatProvider } from "../../../src/services/chat/registry.js";

const KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_CHAT_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_CHAT_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_CHAT_MODEL",
  "OLLAMA_BASE_URL",
  "OLLAMA_CHAT_MODEL",
  "CHAT_PROVIDER",
];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  // This file exercises the env-only (no DB) path, which keys off NODE_ENV=test.
  vi.stubEnv("NODE_ENV", "test");
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("getChatProvider (env-only selection under test)", () => {
  it("is null when nothing is configured", async () => {
    expect(await getChatProvider()).toBeNull();
  });

  it("picks Claude when an Anthropic key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    const p = await getChatProvider();
    expect(p?.name).toBe("claude");
    expect(p?.local).toBe(false);
  });

  it("requires a chat model for OpenRouter and Ollama (vision models don't do tool calls)", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    expect(await getChatProvider()).toBeNull();
    process.env.OPENROUTER_CHAT_MODEL = "some/model";
    expect((await getChatProvider())?.name).toBe("openrouter");
  });

  it("recognizes Ollama as local", async () => {
    process.env.OLLAMA_BASE_URL = "http://localhost:11434/";
    process.env.OLLAMA_CHAT_MODEL = "qwen3";
    const p = await getChatProvider();
    expect(p).toMatchObject({ name: "ollama", local: true });
  });

  it("honours the CHAT_PROVIDER pin", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OPENROUTER_CHAT_MODEL = "m";
    process.env.CHAT_PROVIDER = "openrouter";
    expect((await getChatProvider())?.name).toBe("openrouter");
  });

  it("never falls through from a pinned provider to another one (a 'keep it local' pin stays local)", async () => {
    process.env.ANTHROPIC_API_KEY = "k"; // a cloud key exists, e.g. for vision
    process.env.CHAT_PROVIDER = "ollama"; // pinned, but its model is not set
    process.env.OLLAMA_BASE_URL = "http://localhost:11434";
    expect(await getChatProvider()).toBeNull();
    process.env.OLLAMA_CHAT_MODEL = "qwen3";
    expect((await getChatProvider())?.name).toBe("ollama");
  });

  it("only reports Ollama as local when its URL is on the user's own network", async () => {
    process.env.OLLAMA_CHAT_MODEL = "qwen3";
    for (const [url, local] of [
      ["http://localhost:11434", true],
      ["http://192.168.1.20:11434", true],
      ["http://ollama:11434", true],
      ["https://ollama.example.com", false],
      ["http://8.8.8.8:11434", false],
    ] as const) {
      process.env.OLLAMA_BASE_URL = url;
      expect((await getChatProvider())?.local, url).toBe(local);
    }
  });

  it("asks OpenRouter not to retain prompts unless the operator opts out", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OPENROUTER_CHAT_MODEL = "some/model";
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "x" }, finish_reason: "stop" }] }),
      );
    });
    try {
      const req = { system: "s", messages: [], tools: [], maxTokens: 1 };
      await (await getChatProvider())!.complete(req);
      process.env.OPENROUTER_ALLOW_DATA_COLLECTION = "true";
      await (await getChatProvider())!.complete(req);
    } finally {
      vi.unstubAllGlobals();
      delete process.env.OPENROUTER_ALLOW_DATA_COLLECTION;
    }
    expect(bodies[0]!.provider).toEqual({ data_collection: "deny" });
    expect(bodies[1]!.provider).toBeUndefined();
  });
});

describe("Gemini chat opt-in", () => {
  it("is not selected by a Gemini key alone, even though it outranks OpenRouter in vision priority", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    expect(await getChatProvider()).toBeNull();
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.OPENROUTER_CHAT_MODEL = "some/model";
    expect((await getChatProvider())?.name).toBe("openrouter");
  });

  it("is selected once a chat model is set, and honours the pin", async () => {
    process.env.GEMINI_API_KEY = "g-key";
    process.env.GEMINI_CHAT_MODEL = "gemini-2.5-pro";
    const p = await getChatProvider();
    expect(p).toMatchObject({ name: "gemini", local: false });
    process.env.CHAT_PROVIDER = "gemini";
    expect((await getChatProvider())?.name).toBe("gemini");
  });

  it("accepts a key stored in the admin credentials, still gated on the model", () => {
    const d = CHAT_PROVIDER_REGISTRY.find((c) => c.id === "gemini")!;
    expect(d.configured({ apiKey: "from-db" } as never)).toBe(false);
    process.env.GEMINI_CHAT_MODEL = "m";
    expect(d.configured({ apiKey: "from-db" } as never)).toBe(true);
    expect(d.create({ apiKey: "from-db" } as never).isConfigured()).toBe(true);
  });
});

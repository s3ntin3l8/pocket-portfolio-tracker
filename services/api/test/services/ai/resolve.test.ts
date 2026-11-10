import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChatProvider, resolveScreenshotParser } from "../../../src/services/ai/resolve.js";

const ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_CHAT_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_CHAT_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_CHAT_MODEL",
  "OPENROUTER_ALLOW_DATA_COLLECTION",
  "OLLAMA_BASE_URL",
  "OLLAMA_CHAT_MODEL",
  "SCREENSHOT_PARSER",
  "CHAT_PROVIDER",
];
beforeEach(() => {
  // This file exercises the env-only (no DB) path, which keys off NODE_ENV=test.
  vi.stubEnv("NODE_ENV", "test");
  for (const k of ENV) vi.stubEnv(k, "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveScreenshotParser (env-only under test)", () => {
  it("falls back to an inert claude parser when nothing is configured", async () => {
    const p = await resolveScreenshotParser();
    expect(p.name).toBe("claude");
    expect(p.isConfigured()).toBe(false);
  });

  it("selects the first configured provider", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    expect((await resolveScreenshotParser()).name).toBe("gemini");
  });

  it("honours a SCREENSHOT_PARSER pin even over the order", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    vi.stubEnv("SCREENSHOT_PARSER", "openrouter");
    const p = await resolveScreenshotParser();
    expect(p.name).toBe("openrouter");
    expect(p.isConfigured()).toBe(false); // pinned, but no key: the import route answers 503
  });
});

describe("getChatProvider (env-only under test)", () => {
  it("is null when nothing is configured", async () => {
    expect(await getChatProvider()).toBeNull();
  });

  it("picks Claude when an Anthropic key is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    const p = await getChatProvider();
    expect(p?.name).toBe("claude");
    expect(p?.local).toBe(false);
  });

  it("requires a chat model for OpenRouter and Ollama", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
    expect(await getChatProvider()).toBeNull();
    vi.stubEnv("OPENROUTER_CHAT_MODEL", "some/model");
    expect((await getChatProvider())?.name).toBe("openrouter");
  });

  it("recognizes Ollama as local", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434/");
    vi.stubEnv("OLLAMA_CHAT_MODEL", "qwen3");
    expect(await getChatProvider()).toMatchObject({ name: "ollama", local: true });
  });

  it("honours the CHAT_PROVIDER pin and never falls through from it", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("OPENROUTER_CHAT_MODEL", "m");
    vi.stubEnv("CHAT_PROVIDER", "openrouter");
    expect((await getChatProvider())?.name).toBe("openrouter");

    vi.stubEnv("CHAT_PROVIDER", "ollama"); // pinned, but not configured
    expect(await getChatProvider()).toBeNull();
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
    vi.stubEnv("OLLAMA_CHAT_MODEL", "qwen3");
    expect((await getChatProvider())?.name).toBe("ollama");
  });

  it("is not selected on a Gemini key alone", async () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    expect(await getChatProvider()).toBeNull();
    vi.stubEnv("GEMINI_CHAT_MODEL", "gemini-2.5-pro");
    expect(await getChatProvider()).toMatchObject({ name: "gemini", local: false });
  });

  it("asks OpenRouter not to retain prompts unless the operator opts out", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("OPENROUTER_CHAT_MODEL", "some/model");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "x" }, finish_reason: "stop" }] }),
      );
    });
    const req = { system: "s", messages: [], tools: [], maxTokens: 1 };
    await (await getChatProvider())!.complete(req);
    vi.stubEnv("OPENROUTER_ALLOW_DATA_COLLECTION", "true");
    await (await getChatProvider())!.complete(req);
    expect(bodies[0]!.provider).toEqual({ data_collection: "deny" });
    expect(bodies[1]!.provider).toBeUndefined();
  });
});

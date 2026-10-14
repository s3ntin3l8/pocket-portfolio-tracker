import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getChatProvider } from "../../../src/services/chat/registry.js";

const KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_CHAT_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_CHAT_MODEL",
  "OLLAMA_BASE_URL",
  "OLLAMA_CHAT_MODEL",
  "CHAT_PROVIDER",
];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
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

  it("honours the CHAT_PROVIDER pin and falls through when the pinned one is unconfigured", async () => {
    process.env.ANTHROPIC_API_KEY = "k";
    process.env.OPENROUTER_API_KEY = "k";
    process.env.OPENROUTER_CHAT_MODEL = "m";
    process.env.CHAT_PROVIDER = "openrouter";
    expect((await getChatProvider())?.name).toBe("openrouter");
    process.env.CHAT_PROVIDER = "ollama"; // not configured
    expect((await getChatProvider())?.name).toBe("claude");
  });
});

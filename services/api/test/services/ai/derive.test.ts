import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveTask, NO_LEGACY, type LegacyRows } from "../../../src/services/ai/derive.js";
import { AI_PROVIDER_REGISTRY, isLocalProvider } from "../../../src/services/ai/registry.js";

const ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_VISION_MODEL",
  "ANTHROPIC_CHAT_MODEL",
  "ANTHROPIC_CHAT_EFFORT",
  "GEMINI_API_KEY",
  "GEMINI_VISION_MODEL",
  "GEMINI_CHAT_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_VISION_MODEL",
  "OPENROUTER_CHAT_MODEL",
  "OLLAMA_BASE_URL",
  "OLLAMA_VISION_MODEL",
  "OLLAMA_CHAT_MODEL",
  "SCREENSHOT_PARSER",
  "CHAT_PROVIDER",
];
beforeEach(() => {
  for (const k of ENV) vi.stubEnv(k, ""); // blank = unset for the env helpers
});
afterEach(() => vi.unstubAllEnvs());

const none = new Map();
const legacy = (over: Partial<LegacyRows>): LegacyRows => ({ ...NO_LEGACY, ...over });

describe("registry", () => {
  it("lists claude, gemini, openrouter, ollama in default order", () => {
    expect(AI_PROVIDER_REGISTRY.map((d) => d.id)).toEqual([
      "claude",
      "gemini",
      "openrouter",
      "ollama",
    ]);
  });

  it("ollama is configured by an explicit URL only (env or stored), never by the localhost default", () => {
    const ollama = AI_PROVIDER_REGISTRY.find((d) => d.id === "ollama")!;
    expect(ollama.isConfigured()).toBe(false);
    expect(ollama.isConfigured({ url: "http://my-ollama:11434" })).toBe(true);
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
    expect(ollama.isConfigured()).toBe(true);
  });

  it("a stored key wins over the env key", () => {
    const claude = AI_PROVIDER_REGISTRY.find((d) => d.id === "claude")!;
    expect(claude.isConfigured()).toBe(false);
    expect(claude.isConfigured({ apiKey: "sk-ant-test" })).toBe(true); // pragma: allowlist secret
  });

  it("only reports a URL provider as local when it is on the operator's network", () => {
    const ollama = AI_PROVIDER_REGISTRY.find((d) => d.id === "ollama")!;
    for (const [url, local] of [
      ["http://localhost:11434/", true],
      ["http://192.168.1.20:11434", true],
      ["http://ollama:11434", true],
      ["https://ollama.example.com", false],
      ["http://8.8.8.8:11434", false],
    ] as const) {
      expect(isLocalProvider(ollama, { url }), url).toBe(local);
    }
    expect(isLocalProvider(AI_PROVIDER_REGISTRY[0]!)).toBeNull(); // cloud: not applicable
  });
});

describe("deriveTask · vision", () => {
  it("is off when nothing is configured", () => {
    expect(deriveTask("vision", none)).toMatchObject({ provider: null, model: null });
  });

  it("takes the first configured provider in default order, with its default model", () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    expect(deriveTask("vision", none)).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-flash",
    });
  });

  it("uses the env vision model over the default", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    vi.stubEnv("ANTHROPIC_VISION_MODEL", "claude-x");
    expect(deriveTask("vision", none).model).toBe("claude-x");
  });

  it("an SCREENSHOT_PARSER pin wins over the order, even for an unconfigured provider", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    vi.stubEnv("SCREENSHOT_PARSER", "OpenRouter");
    expect(deriveTask("vision", none).provider).toBe("openrouter");
  });

  it("ignores an unknown pin and counts a stored credential as configured", () => {
    vi.stubEnv("SCREENSHOT_PARSER", "nope");
    const creds = new Map([["gemini", { apiKey: "from-db" }]]); // pragma: allowlist secret
    expect(deriveTask("vision", creds).provider).toBe("gemini");
  });

  it("follows the legacy priority and enabled switches when seeding", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "a");
    vi.stubEnv("GEMINI_API_KEY", "g");
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    const rows = [
      { provider: "claude", enabled: false, priority: 1 },
      { provider: "openrouter", enabled: true, priority: 0 },
    ];
    expect(deriveTask("vision", none, legacy({ vision: rows })).provider).toBe("openrouter");
    expect(deriveTask("vision", none, legacy({ vision: [rows[0]!] })).provider).toBe("gemini"); // claude switched off by the admin
  });
});

describe("deriveTask · chat", () => {
  it("is off when nothing is configured", () => {
    expect(deriveTask("chat", none).provider).toBeNull();
  });

  it("picks Claude on a key alone, with its default model", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    expect(deriveTask("chat", none)).toMatchObject({
      provider: "claude",
      model: "claude-opus-5-5",
    });
  });

  it("carries the Claude effort from the env var", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("ANTHROPIC_CHAT_EFFORT", "high");
    expect(deriveTask("chat", none).effort).toBe("high");
  });

  it("needs a chat model for the others (vision models don't do tool calls)", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
    expect(deriveTask("chat", none).provider).toBeNull();
    vi.stubEnv("OPENROUTER_CHAT_MODEL", "some/model");
    expect(deriveTask("chat", none)).toMatchObject({ provider: "openrouter", model: "some/model" });
  });

  it("is not moved to Gemini by a vision key, though Gemini outranks OpenRouter", () => {
    vi.stubEnv("GEMINI_API_KEY", "g");
    expect(deriveTask("chat", none).provider).toBeNull();
    vi.stubEnv("OPENROUTER_API_KEY", "o");
    vi.stubEnv("OPENROUTER_CHAT_MODEL", "some/model");
    expect(deriveTask("chat", none).provider).toBe("openrouter");
    vi.stubEnv("GEMINI_CHAT_MODEL", "gemini-2.5-pro");
    expect(deriveTask("chat", none).provider).toBe("gemini");
  });

  it("a CHAT_PROVIDER pin is that provider or nothing, never a fall-through", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k"); // a cloud key exists, e.g. for vision
    vi.stubEnv("CHAT_PROVIDER", "ollama");
    // Pinned but unconfigured and without a model: still the pin (so chat stays unavailable).
    expect(deriveTask("chat", none)).toMatchObject({ provider: "ollama", model: null });
    vi.stubEnv("CHAT_PROVIDER", "nope");
    expect(deriveTask("chat", none).provider).toBeNull();
  });

  it("the admin's legacy pin beats the env pin, and legacy overrides win", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("CHAT_PROVIDER", "claude");
    const l = legacy({
      pinned: "openrouter",
      chat: [{ provider: "openrouter", enabled: null, priority: null, model: "admin/model" }],
    });
    expect(deriveTask("chat", none, l)).toMatchObject({
      provider: "openrouter",
      model: "admin/model",
    });
  });

  it("inherits the legacy vision order and switches unless chat overrides them", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "k");
    vi.stubEnv("OPENROUTER_API_KEY", "k");
    vi.stubEnv("OPENROUTER_CHAT_MODEL", "m");
    const off = legacy({ vision: [{ provider: "claude", enabled: false, priority: 1 }] });
    expect(deriveTask("chat", none, off).provider).toBe("openrouter");
    const back = legacy({
      vision: [{ provider: "claude", enabled: false, priority: 1 }],
      chat: [{ provider: "claude", enabled: true, priority: null, model: null }],
    });
    expect(deriveTask("chat", none, back).provider).toBe("claude");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveTask } from "../../../src/services/ai/derive.js";
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
  "OPENAI_COMPAT_BASE_URL",
  "OPENAI_COMPAT_API_KEY",
  "OPENAI_COMPAT_VISION_MODEL",
  "OPENAI_COMPAT_CHAT_MODEL",
  "SCREENSHOT_PARSER",
  "CHAT_PROVIDER",
];
beforeEach(() => {
  for (const k of ENV) vi.stubEnv(k, ""); // blank = unset for the env helpers
});
afterEach(() => vi.unstubAllEnvs());

const none = new Map();

describe("registry", () => {
  it("lists claude, gemini, openrouter, ollama, openai-compatible in default order", () => {
    expect(AI_PROVIDER_REGISTRY.map((d) => d.id)).toEqual([
      "claude",
      "gemini",
      "openrouter",
      "ollama",
      "openai-compatible",
    ]);
  });

  it("openai-compatible: URL credential with an optional key, no default model, not auto-selected", () => {
    const d = AI_PROVIDER_REGISTRY.find((x) => x.id === "openai-compatible")!;
    expect(d).toMatchObject({
      label: "OpenAI-compatible",
      credential: "url",
      credentialEnvVar: "OPENAI_COMPAT_BASE_URL",
      optionalKeyEnvVar: "OPENAI_COMPAT_API_KEY",
      visionModelEnvVar: "OPENAI_COMPAT_VISION_MODEL",
      chatModelEnvVar: "OPENAI_COMPAT_CHAT_MODEL",
      defaultVisionModel: "",
      autoSelect: false,
    });
    expect(d.defaultChatModel).toBeUndefined();
    // Configured by a URL only (stored or env); a key alone is not a connection.
    expect(d.isConfigured()).toBe(false);
    expect(d.isConfigured({ apiKey: "k" })).toBe(false); // pragma: allowlist secret
    expect(d.isConfigured({ url: "http://lmstudio:1234" })).toBe(true);
    vi.stubEnv("OPENAI_COMPAT_BASE_URL", "http://localhost:1234/");
    expect(d.isConfigured()).toBe(true);
    expect(d.baseUrl()).toBe("http://localhost:1234");
    expect(isLocalProvider(d, { url: "https://llm.example.com/v1" })).toBe(false);
    expect(isLocalProvider(d)).toBe(true);
  });

  it("openai-compatible: the env key only goes with the env URL", () => {
    const d = AI_PROVIDER_REGISTRY.find((x) => x.id === "openai-compatible")!;
    vi.stubEnv("OPENAI_COMPAT_API_KEY", "env-key"); // pragma: allowlist secret
    const key = (s: { url?: string; apiKey?: string }) =>
      (d.createChat(s, "m", {}) as unknown as { apiKey?: string }).apiKey;
    expect(key({ url: "http://other:1234" })).toBeUndefined();
    expect(key({ url: "http://other:1234", apiKey: "own" })).toBe("own"); // pragma: allowlist secret
    expect(key({})).toBe("env-key");
  });

  it("openai-compatible: chat and vision normalise the URL with or without /v1 and send the key", () => {
    const d = AI_PROVIDER_REGISTRY.find((x) => x.id === "openai-compatible")!;
    for (const url of [
      "http://lm:1234",
      "http://lm:1234/",
      "http://lm:1234/v1",
      "http://lm:1234/v1/",
    ]) {
      const chat = d.createChat({ url, apiKey: "k" }, "m", {}) as unknown as {
        baseUrl: string;
        apiKey: string;
        name: string;
        local: boolean;
      };
      expect(chat).toMatchObject({
        baseUrl: "http://lm:1234/v1",
        apiKey: "k",
        name: "openai-compatible",
        local: true,
      }); // pragma: allowlist secret
      const vision = d.createVision({ url }, "m") as unknown as { baseUrl: string; name: string };
      expect(vision).toMatchObject({ baseUrl: "http://lm:1234", name: "openai-compatible" });
    }
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

describe("deriveTask · openai-compatible is never auto-selected", () => {
  const creds = new Map([["openai-compatible", { url: "http://lm:1234" }]]);

  it("a configured endpoint alone selects nothing for vision or chat", () => {
    vi.stubEnv("OPENAI_COMPAT_VISION_MODEL", "qwen-vl");
    vi.stubEnv("OPENAI_COMPAT_CHAT_MODEL", "qwen");
    expect(deriveTask("vision", creds).provider).toBeNull();
    expect(deriveTask("chat", creds).provider).toBeNull();
    vi.stubEnv("OPENAI_COMPAT_BASE_URL", "http://lm:1234");
    expect(deriveTask("vision", none).provider).toBeNull();
    expect(deriveTask("chat", none).provider).toBeNull();
  });

  it("is passed over for a later-configured provider too, but an explicit pin selects it", () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://ollama:11434");
    vi.stubEnv("OPENAI_COMPAT_CHAT_MODEL", "qwen");
    expect(deriveTask("vision", creds).provider).toBe("ollama");
    vi.stubEnv("SCREENSHOT_PARSER", "openai-compatible");
    vi.stubEnv("CHAT_PROVIDER", "openai-compatible");
    vi.stubEnv("OPENAI_COMPAT_VISION_MODEL", "qwen-vl");
    expect(deriveTask("vision", creds)).toEqual({
      provider: "openai-compatible",
      model: "qwen-vl",
      effort: null,
    });
    expect(deriveTask("chat", creds)).toEqual({
      provider: "openai-compatible",
      model: "qwen",
      effort: null,
    });
  });

  it("a pinned endpoint with no model seeds no model (none is assumed)", () => {
    vi.stubEnv("SCREENSHOT_PARSER", "openai-compatible");
    expect(deriveTask("vision", creds).model).toBeNull();
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
});

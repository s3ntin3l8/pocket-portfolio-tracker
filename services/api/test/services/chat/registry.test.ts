import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_PROVIDER_REGISTRY,
  buildChatProvider,
  effectivePin,
  getChatProvider,
  resolveChatProviders,
  selectChatProvider,
  type ChatConfig,
} from "../../../src/services/chat/registry.js";

const KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_CHAT_MODEL",
  "GEMINI_API_KEY",
  "GEMINI_CHAT_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_CHAT_MODEL",
  "OLLAMA_BASE_URL",
  "OLLAMA_CHAT_MODEL",
  "ANTHROPIC_CHAT_EFFORT",
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
    process.env.GEMINI_API_KEY = "g-key"; // pragma: allowlist secret
    expect(await getChatProvider()).toBeNull();
    process.env.OPENROUTER_API_KEY = "or-key"; // pragma: allowlist secret
    process.env.OPENROUTER_CHAT_MODEL = "some/model";
    expect((await getChatProvider())?.name).toBe("openrouter");
  });

  it("is selected once a chat model is set, and honours the pin", async () => {
    process.env.GEMINI_API_KEY = "g-key"; // pragma: allowlist secret
    process.env.GEMINI_CHAT_MODEL = "gemini-2.5-pro";
    const p = await getChatProvider();
    expect(p).toMatchObject({ name: "gemini", local: false });
    process.env.CHAT_PROVIDER = "gemini";
    expect((await getChatProvider())?.name).toBe("gemini");
  });

  it("accepts a key stored in the admin credentials, still gated on the model", () => {
    const d = CHAT_PROVIDER_REGISTRY.find((c) => c.id === "gemini")!;
    const secret = { apiKey: "from-db" }; // pragma: allowlist secret
    expect(d.configured(secret, undefined)).toBe(false);
    expect(d.configured(secret, "m")).toBe(true);
    expect(d.create(secret, "m").isConfigured()).toBe(true);
  });
});

describe("resolveChatProviders / selectChatProvider (admin layer)", () => {
  const cfg = (over: Partial<ChatConfig> = {}): ChatConfig => ({
    visionRows: [],
    chatRows: [],
    pinned: null,
    credentials: new Map([
      ["claude", { apiKey: "a" }], // pragma: allowlist secret
      ["gemini", { apiKey: "g" }], // pragma: allowlist secret
      ["ollama", { url: "http://localhost:11434" }],
    ]),
    ...over,
  });
  const ids = (c: ChatConfig) => resolveChatProviders(c).map((s) => s.id);

  it("inherits the vision enable/priority until the admin overrides them for chat", () => {
    expect(ids(cfg())).toEqual(["claude", "gemini", "openrouter", "ollama"]);
    const vision = cfg({
      visionRows: [
        { provider: "ollama", enabled: true, priority: 0 },
        { provider: "claude", enabled: false, priority: 1 },
      ],
    });
    expect(ids(vision)[0]).toBe("ollama");
    expect(resolveChatProviders(vision).find((s) => s.id === "claude")).toMatchObject({
      enabled: false,
      enabledSource: "vision",
      prioritySource: "vision",
    });
    const chat = cfg({
      visionRows: vision.visionRows,
      chatRows: [
        { provider: "claude", enabled: true, priority: 0, model: null },
        { provider: "ollama", enabled: null, priority: 9, model: null },
      ],
    });
    expect(ids(chat)[0]).toBe("claude");
    expect(resolveChatProviders(chat).find((s) => s.id === "claude")).toMatchObject({
      enabled: true,
      enabledSource: "chat",
      prioritySource: "chat",
    });
    expect(resolveChatProviders(chat).find((s) => s.id === "ollama")).toMatchObject({
      priority: 9,
      enabled: true,
      enabledSource: "vision",
    });
  });

  it("resolves the model: admin, then env, then the adapter default, and uses it to gate", () => {
    const base = resolveChatProviders(cfg());
    expect(base.find((s) => s.id === "claude")).toMatchObject({
      model: "claude-opus-5-5",
      modelSource: "default",
    });
    expect(base.find((s) => s.id === "gemini")).toMatchObject({ configured: false, model: null });

    process.env.GEMINI_CHAT_MODEL = "from-env";
    const withEnv = resolveChatProviders(cfg()).find((s) => s.id === "gemini");
    expect(withEnv).toMatchObject({ configured: true, model: "from-env", modelSource: "env" });

    const withDb = resolveChatProviders(
      cfg({
        chatRows: [{ provider: "gemini", enabled: null, priority: null, model: " db-model " }],
      }),
    ).find((s) => s.id === "gemini");
    expect(withDb).toMatchObject({ configured: true, model: "db-model", modelSource: "db" });
    // A model chosen in the admin satisfies the "model required" gate on its own.
    delete process.env.GEMINI_CHAT_MODEL;
    expect(
      resolveChatProviders(
        cfg({ chatRows: [{ provider: "gemini", enabled: null, priority: null, model: "m" }] }),
      ).find((s) => s.id === "gemini")?.configured,
    ).toBe(true);
  });

  it("picks the first enabled, configured provider by priority", () => {
    const states = resolveChatProviders(
      cfg({ chatRows: [{ provider: "claude", enabled: false, priority: null, model: null }] }),
    );
    // claude is off, gemini has no model, openrouter has no key -> ollama needs a model too.
    expect(selectChatProvider(states, null)).toBeNull();
    process.env.OLLAMA_CHAT_MODEL = "qwen";
    expect(selectChatProvider(resolveChatProviders(cfg()), null)?.id).toBe("claude");
    expect(
      selectChatProvider(
        resolveChatProviders(
          cfg({ chatRows: [{ provider: "claude", enabled: false, priority: null, model: null }] }),
        ),
        null,
      )?.id,
    ).toBe("ollama");
  });

  it("never falls through from a pin, and a pin ignores the enabled flag", () => {
    process.env.OLLAMA_CHAT_MODEL = "qwen";
    const off = resolveChatProviders(
      cfg({ chatRows: [{ provider: "ollama", enabled: false, priority: null, model: null }] }),
    );
    expect(selectChatProvider(off, "ollama")?.id).toBe("ollama");
    expect(selectChatProvider(off, "openrouter")).toBeNull(); // pinned but unusable
    expect(selectChatProvider(off, "nonsense")).toBeNull();
  });

  it("takes the pin from the admin setting before the env var", () => {
    expect(effectivePin({ pinned: null })).toEqual({ value: null, source: null });
    process.env.CHAT_PROVIDER = "Ollama";
    expect(effectivePin({ pinned: null })).toEqual({ value: "ollama", source: "env" });
    expect(effectivePin({ pinned: "claude" })).toEqual({ value: "claude", source: "db" });
  });

  it("builds the provider with the resolved model", () => {
    const [s] = resolveChatProviders(
      cfg({ chatRows: [{ provider: "claude", enabled: null, priority: null, model: "claude-x" }] }),
    ).filter((x) => x.id === "claude");
    const p = buildChatProvider(s!, cfg().credentials);
    expect(p.name).toBe("claude");
    expect(p.isConfigured()).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { AnthropicChatProvider } from "../../../src/services/chat/anthropic.js";
import { OpenAICompatChatProvider } from "../../../src/services/chat/openai-compat.js";
import {
  ChatProviderError,
  type ChatMessage,
  type ChatToolSpec,
} from "../../../src/services/chat/types.js";

const TOOLS: ChatToolSpec[] = [
  {
    name: "list_portfolios",
    description: "List portfolios",
    inputSchema: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object" },
  },
];

interface Captured {
  url: string;
  headers: Record<string, string>;
  // Captured request bodies are asserted structurally, field by field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: Record<string, any>;
}

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Captured[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return respond();
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const HISTORY: ChatMessage[] = [
  { role: "user", content: "net worth?" },
  {
    role: "assistant",
    text: "Checking.",
    toolCalls: [{ id: "tu_1", name: "list_portfolios", args: {} }],
  },
  {
    role: "tool",
    results: [{ callId: "tu_1", name: "list_portfolios", content: '{"x":1}', isError: true }],
  },
];

describe("AnthropicChatProvider", () => {
  it("sends the Messages request: tools as input_schema, beta fallback header, default model", async () => {
    const f = fakeFetch(() =>
      json({ content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }),
    );
    const p = new AnthropicChatProvider("sk-test", { fetch: f.impl });
    const out = await p.complete({
      system: "SYS",
      messages: HISTORY,
      tools: TOOLS,
      maxTokens: 123,
    });

    const c = f.calls[0]!;
    expect(c.url).toBe("https://api.anthropic.com/v1/messages");
    expect(c.headers["x-api-key"]).toBe("sk-test");
    expect(c.headers["anthropic-version"]).toBe("2023-06-01");
    expect(c.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect(c.body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 123,
      system: "SYS",
      fallbacks: "default",
    });
    expect(c.body.output_config).toBeUndefined();
    expect(c.body.tools[0]).toMatchObject({
      name: "list_portfolios",
      description: "List portfolios",
    });
    expect(c.body.tools[0].input_schema.type).toBe("object");
    expect(out).toMatchObject({ text: "hi", stop: "end", toolCalls: [] });
  });

  it("maps history: assistant tool_use, then a user message of tool_result blocks (is_error kept)", async () => {
    const f = fakeFetch(() => json({ content: [], stop_reason: "end_turn" }));
    await new AnthropicChatProvider("k", { fetch: f.impl }).complete({
      system: "s",
      messages: HISTORY,
      tools: TOOLS,
      maxTokens: 1,
    });
    const msgs = f.calls[0]!.body.messages;
    expect(msgs[0]).toEqual({ role: "user", content: "net worth?" });
    expect(msgs[1]).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "Checking." },
        { type: "tool_use", id: "tu_1", name: "list_portfolios", input: {} },
      ],
    });
    expect(msgs[2]).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: '{"x":1}', is_error: true }],
    });
  });

  it("parses tool_use, drops fallback markers and replays blocks (incl. thinking) via providerState", async () => {
    const blocks = [
      { type: "fallback", from: { model: "a" }, to: { model: "b" } },
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "Let me look." },
      { type: "tool_use", id: "tu_9", name: "get_net_worth", input: { period: "1y" } },
    ];
    const f = fakeFetch(() => json({ content: blocks, stop_reason: "tool_use", model: "m" }));
    const p = new AnthropicChatProvider("k", { fetch: f.impl });
    const out = await p.complete({ system: "s", messages: [], tools: TOOLS, maxTokens: 1 });
    expect(out.stop).toBe("tool_use");
    expect(out.text).toBe("Let me look.");
    expect(out.toolCalls).toEqual([{ id: "tu_9", name: "get_net_worth", args: { period: "1y" } }]);

    // Replay: the thinking block goes back verbatim; the fallback marker does not.
    await p.complete({
      system: "s",
      tools: TOOLS,
      maxTokens: 1,
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          text: out.text,
          toolCalls: out.toolCalls,
          providerState: out.providerState,
        },
      ],
    });
    const replayed = f.calls[1]!.body.messages[1].content as { type: string }[];
    expect(replayed.map((b) => b.type)).toEqual(["thinking", "text", "tool_use"]);
  });

  it.each([
    ["end_turn", "end"],
    ["tool_use", "tool_use"],
    ["max_tokens", "max_tokens"],
    ["refusal", "refusal"],
    ["something_new", "end"],
  ])("maps stop_reason %s -> %s", async (reason, expected) => {
    const f = fakeFetch(() => json({ content: [], stop_reason: reason }));
    const out = await new AnthropicChatProvider("k", { fetch: f.impl }).complete({
      system: "s",
      messages: [],
      tools: [],
      maxTokens: 1,
    });
    expect(out.stop).toBe(expected);
  });

  it("honours model/effort options and skips the first-party-only fallback on a custom base URL", async () => {
    const f = fakeFetch(() => json({ content: [], stop_reason: "end_turn" }));
    await new AnthropicChatProvider("k", {
      fetch: f.impl,
      model: "claude-sonnet-5-5",
      effort: "low",
      baseUrl: "https://proxy.example",
    }).complete({ system: "s", messages: [], tools: [], maxTokens: 1 });
    const c = f.calls[0]!;
    expect(c.url).toBe("https://proxy.example/v1/messages");
    expect(c.body).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "low" } });
    expect(c.body.fallbacks).toBeUndefined();
    expect(c.headers["anthropic-beta"]).toBeUndefined();
  });

  it("turns HTTP failures into a coded error that carries no upstream body", async () => {
    const f = fakeFetch(() => json({ error: { message: "SECRET prompt echo" } }, 429));
    const p = new AnthropicChatProvider("k", { fetch: f.impl });
    const err = await p
      .complete({ system: "s", messages: [], tools: [], maxTokens: 1 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatProviderError);
    expect(err).toMatchObject({ code: "provider_error", status: 429 });
    expect(String((err as Error).message)).not.toContain("SECRET");
  });

  it("maps network failures and malformed bodies to codes, and rethrows a caller abort", async () => {
    const boom = new AnthropicChatProvider("k", {
      fetch: (async () => {
        throw new TypeError("fetch failed: secret-host");
      }) as unknown as typeof fetch,
    });
    await expect(
      boom.complete({ system: "s", messages: [], tools: [], maxTokens: 1 }),
    ).rejects.toMatchObject({ code: "provider_unreachable" });

    const bad = new AnthropicChatProvider("k", { fetch: fakeFetch(() => json({ nope: 1 })).impl });
    await expect(
      bad.complete({ system: "s", messages: [], tools: [], maxTokens: 1 }),
    ).rejects.toMatchObject({ code: "provider_bad_response" });

    const ac = new AbortController();
    ac.abort();
    const aborted = new AnthropicChatProvider("k", {
      fetch: (async () => {
        throw new DOMException("aborted", "AbortError");
      }) as unknown as typeof fetch,
    });
    await expect(
      aborted.complete({ system: "s", messages: [], tools: [], maxTokens: 1, signal: ac.signal }),
    ).rejects.toThrow(/aborted/);
  });

  it("is unconfigured without a key", async () => {
    const p = new AnthropicChatProvider("  ");
    expect(p.isConfigured()).toBe(false);
    await expect(
      p.complete({ system: "s", messages: [], tools: [], maxTokens: 1 }),
    ).rejects.toMatchObject({ code: "provider_not_configured" });
  });
});

describe("AnthropicChatProvider — edge cases", () => {
  it("returns several tool calls from one turn and omits an empty tools list", async () => {
    const f = fakeFetch(() =>
      json({
        content: [
          { type: "tool_use", id: "a", name: "get_holdings", input: {} },
          { type: "tool_use", id: "b", name: "get_income", input: { year: 2025 } },
        ],
        stop_reason: "tool_use",
      }),
    );
    const out = await new AnthropicChatProvider("k", { fetch: f.impl }).complete({
      system: "s",
      messages: [],
      tools: [],
      maxTokens: 1,
    });
    expect(out.toolCalls.map((c) => c.id)).toEqual(["a", "b"]);
    expect(f.calls[0]!.body.tools).toBeUndefined();
  });

  it("copes with an empty content array", async () => {
    const f = fakeFetch(() => json({ content: [], stop_reason: "end_turn" }));
    const out = await new AnthropicChatProvider("k", { fetch: f.impl }).complete({
      system: "s",
      messages: [],
      tools: [],
      maxTokens: 1,
    });
    expect(out).toMatchObject({ text: "", toolCalls: [], stop: "end" });
  });
});

describe("OpenAICompatChatProvider", () => {
  const make = (
    fetchImpl: typeof fetch,
    over: Partial<ConstructorParameters<typeof OpenAICompatChatProvider>[0]> = {},
  ) =>
    new OpenAICompatChatProvider({
      name: "openrouter",
      label: "OpenRouter",
      local: false,
      baseUrl: "https://openrouter.ai/api/v1/",
      model: "some/model",
      apiKey: "or-key", // pragma: allowlist secret
      fetch: fetchImpl,
      ...over,
    });

  it("posts chat/completions with function tools (draft marker stripped) and a bearer key", async () => {
    const f = fakeFetch(() =>
      json({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
    );
    const out = await make(f.impl).complete({
      system: "SYS",
      messages: HISTORY,
      tools: TOOLS,
      maxTokens: 50,
    });
    const c = f.calls[0]!;
    expect(c.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(c.headers.authorization).toBe("Bearer or-key");
    expect(c.body).toMatchObject({ model: "some/model", max_tokens: 50, tool_choice: "auto" });
    expect(c.body.tools[0]).toEqual({
      type: "function",
      function: {
        name: "list_portfolios",
        description: "List portfolios",
        parameters: { type: "object" },
      },
    });
    expect(c.body.messages[0]).toEqual({ role: "system", content: "SYS" });
    expect(out).toMatchObject({ text: "ok", stop: "end" });
  });

  it("maps history: assistant tool_calls with JSON-string arguments, one tool message per result", async () => {
    const f = fakeFetch(() =>
      json({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
    );
    await make(f.impl).complete({ system: "s", messages: HISTORY, tools: [], maxTokens: 1 });
    const m = f.calls[0]!.body.messages;
    expect(m[2]).toEqual({
      role: "assistant",
      content: "Checking.",
      tool_calls: [
        { id: "tu_1", type: "function", function: { name: "list_portfolios", arguments: "{}" } },
      ],
    });
    expect(m[3]).toEqual({ role: "tool", tool_call_id: "tu_1", content: '{"x":1}' });
  });

  it("parses tool calls (even when finish_reason says stop) and flags unparseable arguments as null", async () => {
    const f = fakeFetch(() =>
      json({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                { id: "c1", function: { name: "get_holdings", arguments: '{"limit": 5}' } },
                { function: { name: "get_income", arguments: "{not json" } },
              ],
            },
            finish_reason: "stop",
          },
        ],
      }),
    );
    const out = await make(f.impl).complete({
      system: "s",
      messages: [],
      tools: TOOLS,
      maxTokens: 1,
    });
    expect(out.stop).toBe("tool_use");
    expect(out.toolCalls).toEqual([
      { id: "c1", name: "get_holdings", args: { limit: 5 } },
      { id: "call_1", name: "get_income", args: null },
    ]);
  });

  it.each([
    ["length", "max_tokens"],
    ["content_filter", "refusal"],
    ["stop", "end"],
  ])("maps finish_reason %s -> %s", async (reason, expected) => {
    const f = fakeFetch(() =>
      json({ choices: [{ message: { content: "x" }, finish_reason: reason }] }),
    );
    expect(
      (await make(f.impl).complete({ system: "s", messages: [], tools: [], maxTokens: 1 })).stop,
    ).toBe(expected);
  });

  it("omits the auth header for a local server and reports local", async () => {
    const f = fakeFetch(() =>
      json({ choices: [{ message: { content: "x" }, finish_reason: "stop" }] }),
    );
    const p = make(f.impl, {
      name: "ollama",
      local: true,
      apiKey: undefined,
      baseUrl: "http://localhost:11434/v1",
    });
    await p.complete({ system: "s", messages: [], tools: [], maxTokens: 1 });
    expect(f.calls[0]!.headers.authorization).toBeUndefined();
    expect(p.local).toBe(true);
    expect(f.calls[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("codes upstream failures without leaking bodies", async () => {
    const http = make(fakeFetch(() => json({ error: "SECRET" }, 500)).impl);
    const err = await http
      .complete({ system: "s", messages: [], tools: [], maxTokens: 1 })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "provider_error", status: 500 });
    expect(String((err as Error).message)).not.toContain("SECRET");

    await expect(
      make(fakeFetch(() => json({ choices: [] })).impl).complete({
        system: "s",
        messages: [],
        tools: [],
        maxTokens: 1,
      }),
    ).rejects.toMatchObject({ code: "provider_bad_response" });

    await expect(
      make((async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch).complete({
        system: "s",
        messages: [],
        tools: [],
        maxTokens: 1,
      }),
    ).rejects.toMatchObject({ code: "provider_unreachable" });
  });

  it("needs a base URL and a model to be configured", () => {
    expect(make(fetch, { model: "" }).isConfigured()).toBe(false);
    expect(make(fetch, { baseUrl: "" }).isConfigured()).toBe(false);
    expect(make(fetch).isConfigured()).toBe(true);
  });

  it("omits tools/tool_choice when there are none and merges extra body fields", async () => {
    const f = fakeFetch(() =>
      json({ choices: [{ message: { content: "x" }, finish_reason: "stop" }] }),
    );
    await make(f.impl, { extraBody: { provider: { data_collection: "deny" } } }).complete({
      system: "s",
      messages: [],
      tools: [],
      maxTokens: 1,
    });
    const body = f.calls[0]!.body;
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.provider).toEqual({ data_collection: "deny" });
  });

  it("replays a tool call with unparseable arguments as an empty object, not the string null", async () => {
    const f = fakeFetch(() =>
      json({ choices: [{ message: { content: "x" }, finish_reason: "stop" }] }),
    );
    await make(f.impl).complete({
      system: "s",
      tools: [],
      maxTokens: 1,
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", text: "", toolCalls: [{ id: "c1", name: "get_income", args: null }] },
        {
          role: "tool",
          results: [{ callId: "c1", name: "get_income", content: "{}", isError: true }],
        },
      ],
    });
    const assistant = f.calls[0]!.body.messages[2];
    expect(assistant.tool_calls[0].function.arguments).toBe("{}");
  });
});

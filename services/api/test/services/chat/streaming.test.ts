import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { AiTool } from "@portfolio/ai-tools";
import { AnthropicChatProvider } from "../../../src/services/chat/anthropic.js";
import { OpenAICompatChatProvider } from "../../../src/services/chat/openai-compat.js";
import { idleGuard, readSseFrames } from "../../../src/services/chat/sse.js";
import { runChat, type ChatEvent } from "../../../src/services/chat/loop.js";
import {
  ChatProviderError,
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
} from "../../../src/services/chat/types.js";

const enc = new TextEncoder();

/** A streaming body that delivers `chunks` as separate reads (frames may straddle chunks). */
function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}
const sse = (event: string | null, data: unknown) =>
  `${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
const streamRes = (chunks: string[], status = 200) =>
  new Response(sseBody(chunks), { status, headers: { "content-type": "text/event-stream" } });

const REQ: ChatRequest = {
  system: "s",
  messages: [{ role: "user", content: "hi" }],
  tools: [],
  maxTokens: 100,
};

describe("readSseFrames", () => {
  it("joins frames split across chunks, handles CRLF, comments and multi-line data", async () => {
    const out = [];
    for await (const f of readSseFrames(
      sseBody([": ka\r\n\r\nevent: a\r\ndata: 1\r\n", "\r\ndata: x\ndata: y\n\n", "data: tail"]),
    ))
      out.push(f);
    expect(out).toEqual([
      { event: "a", data: "1" },
      { event: "message", data: "x\ny" },
      { event: "message", data: "tail" },
    ]);
  });
});

describe("idleGuard", () => {
  it("aborts when no chunk arrives in time and stays quiet once stopped", async () => {
    const g = idleGuard(undefined, 20);
    await new Promise((r) => setTimeout(r, 60));
    expect(g.signal.aborted).toBe(true);
    const h = idleGuard(undefined, 20);
    h.stop();
    await new Promise((r) => setTimeout(r, 60));
    expect(h.signal.aborted).toBe(false);
    const ac = new AbortController();
    const i = idleGuard(ac.signal, 1000);
    ac.abort();
    expect(i.signal.aborted).toBe(true);
    i.stop();
  });
});

describe("AnthropicChatProvider.stream", () => {
  const provider = (chunks: string[], status = 200) =>
    new AnthropicChatProvider("k", {
      fetch: (async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return streamRes(chunks, status);
      }) as unknown as typeof fetch,
    });
  const bodies: Record<string, unknown>[] = [];

  const start = sse("message_start", {
    type: "message_start",
    message: { model: "m", usage: { input_tokens: 3 } },
  });
  const stop = (reason: string) =>
    sse("message_delta", {
      type: "message_delta",
      delta: { stop_reason: reason },
      usage: { output_tokens: 5 },
    });

  it("streams text deltas and returns the whole turn, requesting stream:true", async () => {
    const deltas: string[] = [];
    const p = provider([
      start,
      sse("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hel" },
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "lo" },
      }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      stop("end_turn"),
    ]);
    const out = await p.stream(REQ, (t) => deltas.push(t));
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(out).toMatchObject({ text: "Hello", toolCalls: [], stop: "end" });
    expect(bodies.at(-1)).toMatchObject({ stream: true });
  });

  it("assembles a tool call from JSON split across deltas and keeps thinking blocks for replay", async () => {
    const p = provider([
      start,
      sse("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "hm" },
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig" },
      }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("content_block_start", {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "tu_1", name: "echo", input: {} },
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"n":' },
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: "4}" },
      }),
      sse("content_block_stop", { type: "content_block_stop", index: 1 }),
      stop("tool_use"),
    ]);
    const out = await p.stream(REQ, () => {});
    expect(out.stop).toBe("tool_use");
    expect(out.toolCalls).toEqual([{ id: "tu_1", name: "echo", args: { n: 4 } }]);
    expect(out.providerState).toEqual({
      content: [
        { type: "thinking", thinking: "hm", signature: "sig" },
        { type: "tool_use", id: "tu_1", name: "echo", input: { n: 4 } },
      ],
    });
  });

  it("treats a tool with no input deltas as empty args, and truncated JSON as null", async () => {
    const out = await provider([
      start,
      sse("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "a", name: "x", input: {} },
      }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("content_block_start", {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "b", name: "y", input: {} },
      }),
      sse("content_block_delta", {
        type: "content_block_delta",
        index: 1,
        delta: { type: "input_json_delta", partial_json: '{"n":' },
      }),
      stop("max_tokens"),
    ]).stream(REQ, () => {});
    expect(out.stop).toBe("max_tokens");
    expect(out.toolCalls.map((c) => c.args)).toEqual([{}, null]);
  });

  it("maps refusal and ignores keepalive pings and bad frames", async () => {
    const out = await provider([
      start,
      sse("ping", { type: "ping" }),
      sse(null, "{not json"),
      stop("refusal"),
    ]).stream(REQ, () => {});
    expect(out.stop).toBe("refusal");
  });

  it("turns a mid-stream error event into provider_error, with no upstream detail", async () => {
    const err = await provider([
      start,
      sse("error", {
        type: "error",
        error: { type: "overloaded_error", message: "secret detail" },
      }),
    ])
      .stream(REQ, () => {})
      .catch((e) => e);
    expect(err).toBeInstanceOf(ChatProviderError);
    expect(err).toMatchObject({ code: "provider_error" });
    expect(String(err.message)).not.toContain("secret");
  });

  it("fails on an HTTP error, a stream that never finishes, and an unconfigured key", async () => {
    await expect(provider([], 529).stream(REQ, () => {})).rejects.toMatchObject({
      code: "provider_error",
      status: 529,
    });
    await expect(provider([start]).stream(REQ, () => {})).rejects.toMatchObject({
      code: "provider_bad_response",
    });
    await expect(new AnthropicChatProvider("").stream(REQ, () => {})).rejects.toMatchObject({
      code: "provider_not_configured",
    });
  });

  it("reports a broken connection as provider_unreachable but rethrows the caller's abort", async () => {
    const broken = new AnthropicChatProvider("k", {
      fetch: (async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(enc.encode(start));
              c.error(new Error("socket reset"));
            },
          }),
        )) as unknown as typeof fetch,
    });
    await expect(broken.stream(REQ, () => {})).rejects.toMatchObject({
      code: "provider_unreachable",
    });

    const ac = new AbortController();
    const aborted = new AnthropicChatProvider("k", {
      fetch: (async () => {
        ac.abort();
        throw new DOMException("aborted", "AbortError");
      }) as unknown as typeof fetch,
    });
    await expect(aborted.stream({ ...REQ, signal: ac.signal }, () => {})).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("OpenAICompatChatProvider.stream", () => {
  const make = (chunks: string[], status = 200) =>
    new OpenAICompatChatProvider({
      name: "ollama",
      label: "Ollama",
      local: true,
      baseUrl: "http://x/v1",
      model: "m",
      fetch: (async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return streamRes(chunks, status);
      }) as unknown as typeof fetch,
    });
  const bodies: Record<string, unknown>[] = [];
  const chunk = (delta: unknown, finish: string | null = null) =>
    sse(null, { choices: [{ delta, finish_reason: finish }] });

  it("streams content and asks for usage", async () => {
    const deltas: string[] = [];
    const out = await make([
      chunk({ content: "Hi" }),
      chunk({ content: " there" }, "stop"),
      sse(null, { choices: [], usage: { total_tokens: 9 } }),
      sse(null, "[DONE]"),
    ]).stream(REQ, (t) => deltas.push(t));
    expect(deltas).toEqual(["Hi", " there"]);
    expect(out).toMatchObject({ text: "Hi there", toolCalls: [], stop: "end" });
    expect(bodies.at(-1)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it("accumulates tool-call fragments by index, in order, with a synthesized id fallback", async () => {
    const out = await make([
      chunk({ tool_calls: [{ index: 1, function: { name: "b", arguments: '{"n"' } }] }),
      chunk({ tool_calls: [{ index: 0, id: "c0", function: { name: "a", arguments: "{}" } }] }),
      chunk({ tool_calls: [{ index: 1, function: { arguments: ":2}" } }] }, "tool_calls"),
    ]).stream(REQ, () => {});
    expect(out.stop).toBe("tool_use");
    expect(out.toolCalls).toEqual([
      { id: "c0", name: "a", args: {} },
      { id: "call_1", name: "b", args: { n: 2 } },
    ]);
  });

  it("marks tool calls cut off by the token limit as unusable and stops with max_tokens", async () => {
    const out = await make([
      chunk({ tool_calls: [{ index: 0, id: "c", function: { name: "a", arguments: '{"n":' } }] }),
      chunk({}, "length"),
    ]).stream(REQ, () => {});
    expect(out.stop).toBe("max_tokens");
    expect(out.toolCalls[0]!.args).toBeNull();
  });

  it("maps content_filter to refusal, and errors/empty streams/HTTP failures to codes", async () => {
    expect(
      (await make([chunk({ content: "x" }, "content_filter")]).stream(REQ, () => {})).stop,
    ).toBe("refusal");
    await expect(
      make([sse(null, { error: { message: "boom" } })]).stream(REQ, () => {}),
    ).rejects.toMatchObject({
      code: "provider_error",
    });
    await expect(make([sse(null, "[DONE]")]).stream(REQ, () => {})).rejects.toMatchObject({
      code: "provider_bad_response",
    });
    await expect(make([], 500).stream(REQ, () => {})).rejects.toMatchObject({
      code: "provider_error",
      status: 500,
    });
    expect(
      (await make([sse(null, "{bad"), chunk({ content: "ok" }, "stop")]).stream(REQ, () => {}))
        .text,
    ).toBe("ok");
  });
});

describe("runChat with a streaming provider", () => {
  const echo: AiTool = {
    name: "echo",
    title: "Echo",
    description: "Echo",
    inputSchema: z.object({ n: z.number() }),
    handler: async (i) => ({ n: (i as { n: number }).n }),
  };

  function streaming(turns: { deltas: string[]; result: ChatResult }[]) {
    let i = 0;
    const provider: ChatProvider = {
      name: "fake",
      label: "Fake",
      local: false,
      isConfigured: () => true,
      complete: async () => {
        throw new Error("complete must not be used when stream exists");
      },
      async stream(_req, onDelta) {
        const t = turns[i++]!;
        t.deltas.forEach(onDelta);
        return t.result;
      },
    };
    return provider;
  }
  const run = async (provider: ChatProvider) => {
    const events: ChatEvent[] = [];
    await runChat({
      provider,
      system: "s",
      history: [{ role: "user", content: "q" }],
      tools: [echo],
      emit: (e) => events.push(e),
    });
    return events;
  };

  it("emits deltas before the turn's message, and keeps order across a tool round", async () => {
    const events = await run(
      streaming([
        {
          deltas: ["Let me ", "check."],
          result: {
            text: "Let me check.",
            toolCalls: [{ id: "1", name: "echo", args: { n: 1 } }],
            stop: "tool_use",
          },
        },
        { deltas: ["Done."], result: { text: "Done.", toolCalls: [], stop: "end" } },
      ]),
    );
    expect(events.map((e) => e.type)).toEqual([
      "delta",
      "delta",
      "message",
      "tool_call",
      "tool_result",
      "delta",
      "message",
      "done",
    ]);
  });

  it("never runs tools from a turn cut off by max_tokens", async () => {
    let ran = false;
    const spy: AiTool = { ...echo, handler: async () => ((ran = true), {}) };
    const events: ChatEvent[] = [];
    await runChat({
      provider: streaming([
        {
          deltas: ["partial"],
          result: {
            text: "partial",
            toolCalls: [{ id: "1", name: "echo", args: null }],
            stop: "max_tokens",
          },
        },
      ]),
      system: "s",
      history: [{ role: "user", content: "q" }],
      tools: [spy],
      emit: (e) => events.push(e),
    });
    expect(ran).toBe(false);
    expect(events.map((e) => e.type)).toEqual(["delta", "message", "error"]);
    expect(events.at(-1)).toMatchObject({ error: "truncated" });
  });
});

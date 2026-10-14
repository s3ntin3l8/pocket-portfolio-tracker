import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { AiTool } from "@portfolio/ai-tools";
import {
  MAX_TOOL_RESULT_CHARS,
  MAX_TOOL_ROUNDS,
  runChat,
  type ChatEvent,
} from "../../../src/services/chat/loop.js";
import {
  ChatProviderError,
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
} from "../../../src/services/chat/types.js";

function scripted(turns: (ChatResult | Error | ((req: ChatRequest) => ChatResult))[]) {
  const requests: ChatRequest[] = [];
  let i = 0;
  const provider: ChatProvider = {
    name: "fake",
    label: "Fake",
    local: false,
    isConfigured: () => true,
    async complete(req) {
      // Snapshot: the loop keeps appending to the same array.
      requests.push({ ...req, messages: structuredClone(req.messages) });
      const t = turns[Math.min(i++, turns.length - 1)]!;
      if (t instanceof Error) throw t;
      return typeof t === "function" ? t(req) : t;
    },
  };
  return { provider, requests, calls: () => i };
}

const call = (id: string, name: string, args: unknown = {}) => ({ id, name, args });
const toolTurn = (...calls: ReturnType<typeof call>[]): ChatResult => ({
  text: "",
  toolCalls: calls,
  stop: "tool_use",
});
const endTurn = (text = "done"): ChatResult => ({ text, toolCalls: [], stop: "end" });

const echo: AiTool = {
  name: "echo",
  title: "Echo",
  description: "Echo",
  inputSchema: z.object({ n: z.number() }),
  handler: async (input) => ({ n: (input as { n: number }).n }),
};

async function run(
  provider: ChatProvider,
  tools: AiTool[] = [echo],
  signal?: AbortSignal,
): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  await runChat({
    provider,
    system: "SYS",
    history: [{ role: "user", content: "hi" }],
    tools,
    signal,
    emit: (e) => events.push(e),
  });
  return events;
}

describe("runChat", () => {
  it("answers directly when no tool is called", async () => {
    const s = scripted([endTurn("hello")]);
    expect(await run(s.provider)).toEqual([
      { type: "message", text: "hello" },
      { type: "done", rounds: 1 },
    ]);
    expect(s.requests[0]!.tools.map((t) => t.name)).toEqual(["echo"]);
    expect(s.requests[0]!.system).toBe("SYS");
  });

  it("runs tools, feeds results back and finishes", async () => {
    const s = scripted([
      toolTurn(call("a", "echo", { n: 1 }), call("b", "echo", { n: 2 })),
      endTurn("two"),
    ]);
    const events = await run(s.provider);
    expect(events.map((e) => e.type)).toEqual([
      "tool_call",
      "tool_call",
      "tool_result",
      "tool_result",
      "message",
      "done",
    ]);
    expect(events[0]).toMatchObject({ type: "tool_call", name: "echo", input: { n: 1 } });
    const second = s.requests[1]!.messages;
    expect(second.at(-2)).toMatchObject({
      role: "assistant",
      toolCalls: [{ id: "a" }, { id: "b" }],
    });
    expect(second.at(-1)).toEqual({
      role: "tool",
      results: [
        { callId: "a", name: "echo", content: '{"n":1}', isError: false },
        { callId: "b", name: "echo", content: '{"n":2}', isError: false },
      ],
    });
  });

  it("turns an unknown tool and invalid arguments into error results, not crashes", async () => {
    const s = scripted([
      toolTurn(call("a", "nope"), call("b", "echo", { n: "x" }), call("c", "echo", null)),
      endTurn(),
    ]);
    const events = await run(s.provider);
    const results = events.filter((e) => e.type === "tool_result");
    expect(results.map((r) => (r as { ok: boolean }).ok)).toEqual([false, false, false]);
    const sent = s.requests[1]!.messages.at(-1) as {
      results: { content: string; isError: boolean }[];
    };
    expect(sent.results.map((r) => r.content)).toEqual([
      '{"error":"unknown_tool"}',
      '{"error":"invalid_arguments"}',
      '{"error":"invalid_arguments"}',
    ]);
    expect(sent.results.every((r) => r.isError)).toBe(true);
  });

  it("flags a tool that returns the sanitized error shape", async () => {
    const failing: AiTool = {
      ...echo,
      name: "failing",
      handler: async () => ({ error: "request_failed", status: 404 }),
    };
    const s = scripted([toolTurn(call("a", "failing", { n: 1 })), endTurn()]);
    const events = await run(s.provider, [failing]);
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ ok: false });
  });

  it("caps oversized tool results", async () => {
    const big: AiTool = {
      ...echo,
      name: "big",
      handler: async () => ({ blob: "x".repeat(60_000) }),
    };
    const s = scripted([toolTurn(call("a", "big", { n: 1 })), endTurn()]);
    await run(s.provider, [big]);
    const sent = (s.requests[1]!.messages.at(-1) as { results: { content: string }[] }).results[0]!
      .content;
    expect(sent.length).toBeLessThan(MAX_TOOL_RESULT_CHARS + 200);
    expect(sent).toMatch(/\[truncated: the result exceeded/);
  });

  it(`stops after ${MAX_TOOL_ROUNDS} tool rounds`, async () => {
    const s = scripted([toolTurn(call("a", "echo", { n: 1 }))]); // never stops asking
    const events = await run(s.provider);
    expect(events.at(-1)).toEqual({ type: "error", error: "too_many_tool_rounds" });
    expect(s.calls()).toBe(MAX_TOOL_ROUNDS + 1);
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(MAX_TOOL_ROUNDS);
  });

  it("reports provider failures as short codes only", async () => {
    const coded = await run(scripted([new ChatProviderError("provider_error", 429)]).provider);
    expect(coded).toEqual([{ type: "error", error: "provider_error", status: 429 }]);
    const other = await run(scripted([new Error("stack with /srv/secret")]).provider);
    expect(other).toEqual([{ type: "error", error: "chat_failed" }]);
  });

  it("surfaces refusals and truncation without running tools", async () => {
    const refused = await run(scripted([{ text: "", toolCalls: [], stop: "refusal" }]).provider);
    expect(refused).toEqual([{ type: "error", error: "refused" }]);
    const cut = await run(
      scripted([{ text: "partial", toolCalls: [call("a", "echo", { n: 1 })], stop: "max_tokens" }])
        .provider,
    );
    expect(cut).toEqual([
      { type: "message", text: "partial" },
      { type: "error", error: "truncated" },
    ]);
  });

  it("stops without further model calls once the client has gone", async () => {
    const ac = new AbortController();
    const s = scripted([
      () => {
        ac.abort(); // client disconnects during the first turn
        return toolTurn(call("a", "echo", { n: 1 }));
      },
      endTurn(),
    ]);
    const events = await run(s.provider, [echo], ac.signal);
    expect(s.calls()).toBe(1);
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("swallows an abort-induced provider error silently", async () => {
    const ac = new AbortController();
    const s = scripted([
      () => {
        ac.abort();
        throw new DOMException("aborted", "AbortError");
      },
    ]);
    expect(await run(s.provider, [echo], ac.signal)).toEqual([]);
  });

  it("passes the abort signal to the provider", async () => {
    const ac = new AbortController();
    const s = scripted([endTurn()]);
    await run(s.provider, [echo], ac.signal);
    expect(s.requests[0]!.signal).toBe(ac.signal);
  });
});

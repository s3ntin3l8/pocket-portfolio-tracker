import { describe, it, expect } from "vitest";
import { z } from "zod";
import type { AiTool } from "@portfolio/ai-tools";
import {
  MAX_TOOL_CALLS_PER_ROUND,
  MAX_TOOL_RESULT_CHARS,
  MAX_TOOL_ROUNDS,
  MAX_TOTAL_TOOL_RESULT_CHARS,
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
    // Wrapped, not cut mid-JSON: the model always receives parseable JSON.
    const wrapped = JSON.parse(sent);
    expect(wrapped).toMatchObject({ truncated: true });
    expect(wrapped.partial.startsWith('{"blob":"xxx')).toBe(true);
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

  it("never runs a tool whose arguments were not valid JSON, even if every field is optional", async () => {
    let ran = 0;
    const optional: AiTool = {
      ...echo,
      name: "optional",
      inputSchema: z.object({ n: z.number().optional() }),
      handler: async () => {
        ran++;
        return { ok: true };
      },
    };
    const s = scripted([toolTurn(call("a", "optional", null)), endTurn()]);
    const events = await run(s.provider, [optional]);
    expect(ran).toBe(0);
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ ok: false });
    const sent = s.requests[1]!.messages.at(-1) as { results: { content: string }[] };
    expect(sent.results[0]!.content).toBe('{"error":"invalid_arguments"}');
  });

  it(`runs at most ${MAX_TOOL_CALLS_PER_ROUND} tool calls per turn but still answers every call`, async () => {
    let ran = 0;
    const counting: AiTool = {
      ...echo,
      name: "count",
      handler: async () => {
        ran++;
        return { ok: true };
      },
    };
    const total = MAX_TOOL_CALLS_PER_ROUND + 3;
    const calls = Array.from({ length: total }, (_, i) => call(`c${i}`, "count", { n: i }));
    const s = scripted([toolTurn(...calls), endTurn()]);
    await run(s.provider, [counting]);
    expect(ran).toBe(MAX_TOOL_CALLS_PER_ROUND);
    const sent = (
      s.requests[1]!.messages.at(-1) as { results: { callId: string; content: string }[] }
    ).results;
    expect(sent.map((r) => r.callId)).toEqual(calls.map((c) => c.id)); // every call has a result
    expect(
      sent
        .slice(MAX_TOOL_CALLS_PER_ROUND)
        .every((r) => r.content === '{"error":"too_many_tool_calls"}'),
    ).toBe(true);
  });

  it("stops feeding results to the model once the per-request budget is spent", async () => {
    const huge: AiTool = {
      ...echo,
      name: "huge",
      handler: async () => ({ blob: "x".repeat(MAX_TOOL_RESULT_CHARS) }),
    };
    // Each round returns one ~24k result; the budget (120k) runs out after a few rounds.
    const s = scripted([toolTurn(call("a", "huge", { n: 1 }))]);
    await run(s.provider, [huge]);
    const sizes = s.requests.slice(1).map((r) => {
      const last = r.messages.at(-1) as { results: { content: string }[] };
      return last.results[0]!.content;
    });
    const fed = sizes
      .filter((c) => !c.startsWith('{"error":"result_budget_exceeded"'))
      .join("").length;
    expect(fed).toBeLessThanOrEqual(MAX_TOTAL_TOOL_RESULT_CHARS + 500);
    expect(sizes.some((c) => c === '{"error":"result_budget_exceeded"}')).toBe(true);
  });

  it("reports tool results in call order even when the tools finish out of order", async () => {
    const slow: AiTool = {
      ...echo,
      name: "slow",
      handler: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { which: "slow" };
      },
    };
    const fast: AiTool = { ...echo, name: "fast", handler: async () => ({ which: "fast" }) };
    const s = scripted([
      toolTurn(call("a", "slow", { n: 1 }), call("b", "fast", { n: 1 })),
      endTurn(),
    ]);
    const events = await run(s.provider, [slow, fast]);
    expect(
      events
        .filter((e) => e.type.startsWith("tool_"))
        .map((e) => `${e.type}:${(e as { id: string }).id}`),
    ).toEqual(["tool_call:a", "tool_call:b", "tool_result:a", "tool_result:b"]);
    const sent = (s.requests[1]!.messages.at(-1) as { results: { callId: string }[] }).results;
    expect(sent.map((r) => r.callId)).toEqual(["a", "b"]);
  });

  it("isolates a throwing tool: it gets a failed result and the other calls still finish", async () => {
    const boom: AiTool = {
      ...echo,
      name: "boom",
      handler: async () => {
        throw new Error("secret stack /srv/app");
      },
    };
    const s = scripted([
      toolTurn(call("a", "boom", { n: 1 }), call("b", "echo", { n: 2 })),
      endTurn("ok"),
    ]);
    const events = await run(s.provider, [boom, echo]);
    expect(
      events.filter((e) => e.type === "tool_result").map((e) => (e as { ok: boolean }).ok),
    ).toEqual([false, true]);
    expect(events.at(-1)).toEqual({ type: "done", rounds: 2 });
    const sent = (s.requests[1]!.messages.at(-1) as { results: { content: string }[] }).results;
    expect(sent[0]!.content).toBe('{"error":"tool_failed"}');
    expect(JSON.stringify(sent)).not.toContain("secret stack");
  });
});

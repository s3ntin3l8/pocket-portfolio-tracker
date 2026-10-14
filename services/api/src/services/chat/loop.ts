import { isToolError, toJsonSchema, type AiTool } from "@portfolio/ai-tools";
import { ChatProviderError } from "./types.js";
import type { ChatMessage, ChatProvider, ChatToolCall, ChatToolResult } from "./types.js";
import type { Logger } from "../parsers/types.js";

/** Caps that bound cost and runaway loops. */
export const MAX_TOOL_ROUNDS = 8;
export const MAX_TOKENS = 8000;
export const MAX_TOOL_RESULT_CHARS = 24_000;
/** Parallel tool calls run per model turn; extra calls get an error result (every call needs one). */
export const MAX_TOOL_CALLS_PER_ROUND = 8;
/** Total tool-result characters fed back to the model across one request. */
export const MAX_TOTAL_TOOL_RESULT_CHARS = 120_000;

/**
 * What the route streams to the client (one SSE event each). `delta` carries text fragments as
 * they arrive; `message` is the complete text of the turn and marks the turn as finished.
 */
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean }
  | { type: "message"; text: string }
  | { type: "error"; error: string; status?: number }
  | { type: "done"; rounds: number };

export interface RunChatOptions {
  provider: ChatProvider;
  system: string;
  history: ChatMessage[];
  tools: AiTool[];
  emit: (event: ChatEvent) => void;
  signal?: AbortSignal;
  log?: Logger;
}

/**
 * Drive the model <-> tools loop. Every failure ends as an `error` event with a short code:
 * provider bodies, stacks and tool internals never reach the client.
 */
export async function runChat(opts: RunChatOptions): Promise<void> {
  const { provider, system, tools, emit, signal, log } = opts;
  const messages: ChatMessage[] = [...opts.history];
  const budget = { remaining: MAX_TOTAL_TOOL_RESULT_CHARS };
  const specs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toJsonSchema(t),
  }));

  for (let round = 1; round <= MAX_TOOL_ROUNDS + 1; round++) {
    if (signal?.aborted) return;

    let result;
    try {
      const req = { system, messages, tools: specs, maxTokens: MAX_TOKENS, signal };
      result = provider.stream
        ? await provider.stream(req, (text) => emit({ type: "delta", text }), log)
        : await provider.complete(req, log);
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof ChatProviderError) {
        emit({ type: "error", error: err.code, ...(err.status ? { status: err.status } : {}) });
      } else {
        log?.error({ err: err instanceof Error ? err.name : "unknown" }, "chat turn failed");
        emit({ type: "error", error: "chat_failed" });
      }
      return;
    }

    if (result.text) emit({ type: "message", text: result.text });
    if (result.stop === "refusal") return void emit({ type: "error", error: "refused" });
    if (result.stop === "max_tokens") return void emit({ type: "error", error: "truncated" });
    if (result.toolCalls.length === 0) return void emit({ type: "done", rounds: round });
    if (round > MAX_TOOL_ROUNDS) return void emit({ type: "error", error: "too_many_tool_rounds" });

    messages.push({
      role: "assistant",
      text: result.text,
      toolCalls: result.toolCalls,
      providerState: result.providerState,
    });
    // Validate first, announce every call in order, run the handlers in parallel (each isolated
    // so one throw can't strand the others), then cap and report the results in call order:
    // the client can pair tool_call/tool_result by position as well as by id, and the
    // per-request result budget is applied deterministically.
    const prepared = result.toolCalls.map((c, i) => prepare(c, tools, i));
    for (const p of prepared) {
      emit({ type: "tool_call", id: p.call.id, name: p.call.name, input: p.input });
    }
    const outs = await Promise.all(prepared.map((p) => execute(p, signal)));
    // The client left while the tools ran: nothing is waiting for the answer, so stop here
    // rather than feeding results to another model call.
    if (signal?.aborted) return;
    messages.push({
      role: "tool",
      results: prepared.map((p, i) => finish(p, outs[i], budget, emit)),
    });
  }
}

interface Prepared {
  call: ChatToolCall;
  tool?: AiTool;
  /** The validated input, or null when the call will not run. */
  input: unknown;
  /** Why the call will not run, as the error code the model is told. */
  failure?: string;
}

function prepare(call: ChatToolCall, tools: AiTool[], index: number): Prepared {
  // Every tool call must be answered, so rejected calls still get a (failed) result.
  if (index >= MAX_TOOL_CALLS_PER_ROUND)
    return { call, input: null, failure: "too_many_tool_calls" };
  const tool = tools.find((t) => t.name === call.name);
  if (!tool) return { call, input: null, failure: "unknown_tool" };
  // `null` means the model's arguments were not valid JSON: never run with defaults.
  const parsed = call.args === null ? null : tool.inputSchema.safeParse(call.args ?? {});
  if (!parsed?.success) return { call, input: null, failure: "invalid_arguments" };
  return { call, tool, input: parsed.data };
}

/**
 * Run one validated call. Once the client has gone we stop *waiting* for it (and don't start
 * calls that haven't begun); an already-running handler can't be cancelled — it is an
 * in-process API request — but its result is discarded, and the caps bound what it can cost.
 */
async function execute(p: Prepared, signal?: AbortSignal): Promise<unknown> {
  if (p.failure || !p.tool) return { error: p.failure ?? "unknown_tool" };
  if (signal?.aborted) return { error: "aborted" };
  const gone = new Promise<{ error: string }>((resolve) =>
    signal?.addEventListener("abort", () => resolve({ error: "aborted" }), { once: true }),
  );
  try {
    // The built-in handlers already turn API failures into `{ error, status }` and redact.
    return await Promise.race([p.tool.handler(p.input), gone]);
  } catch {
    return { error: "tool_failed" };
  }
}

function finish(
  p: Prepared,
  rawOut: unknown,
  budget: { remaining: number },
  emit: (e: ChatEvent) => void,
): ChatToolResult {
  // Once the budget is spent the model only gets the (tiny) error, never a truncated payload.
  const exhausted = budget.remaining <= 0;
  const out = exhausted ? { error: "result_budget_exceeded" } : rawOut;
  const ok = !isToolError(out);
  const content = exhausted
    ? JSON.stringify(out)
    : capResult(out, Math.min(MAX_TOOL_RESULT_CHARS, budget.remaining));
  budget.remaining -= content.length;
  emit({ type: "tool_result", id: p.call.id, name: p.call.name, ok });
  return { callId: p.call.id, name: p.call.name, content, isError: !ok };
}

/** Over-long results are wrapped, not cut mid-JSON, so the model always receives parseable JSON. */
function capResult(out: unknown, limit: number): string {
  const json = JSON.stringify(out);
  if (json.length <= limit) return json;
  const keep = Math.max(0, limit - 200);
  return JSON.stringify({
    truncated: true,
    note: `The result exceeded ${limit} characters; narrow the query. Partial JSON follows.`,
    partial: json.slice(0, keep),
  });
}

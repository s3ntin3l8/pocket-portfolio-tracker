import { isToolError, toJsonSchema, type AiTool } from "@portfolio/ai-tools";
import { ChatProviderError } from "./types.js";
import type { ChatMessage, ChatProvider, ChatToolCall, ChatToolResult } from "./types.js";
import type { Logger } from "../parsers/types.js";

/** Caps that bound cost and runaway loops. */
export const MAX_TOOL_ROUNDS = 8;
export const MAX_TOKENS = 8000;
export const MAX_TOOL_RESULT_CHARS = 24_000;

/** What the route streams to the client (one SSE event each). Per turn, not per token. */
export type ChatEvent =
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
  const specs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toJsonSchema(t),
  }));

  for (let round = 1; round <= MAX_TOOL_ROUNDS + 1; round++) {
    if (signal?.aborted) return;

    let result;
    try {
      result = await provider.complete(
        { system, messages, tools: specs, maxTokens: MAX_TOKENS, signal },
        log,
      );
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
    const results = await Promise.all(result.toolCalls.map((c) => runTool(c, tools, emit)));
    messages.push({ role: "tool", results });
  }
}

async function runTool(
  call: ChatToolCall,
  tools: AiTool[],
  emit: (e: ChatEvent) => void,
): Promise<ChatToolResult> {
  const tool = tools.find((t) => t.name === call.name);
  let out: unknown;
  if (!tool) {
    emit({ type: "tool_call", id: call.id, name: call.name, input: null });
    out = { error: "unknown_tool" };
  } else {
    const parsed = tool.inputSchema.safeParse(call.args ?? {});
    emit({
      type: "tool_call",
      id: call.id,
      name: call.name,
      input: parsed.success ? parsed.data : null,
    });
    // The handler already converts API failures into `{ error, status }` and redacts.
    out = parsed.success ? await tool.handler(parsed.data) : { error: "invalid_arguments" };
  }
  const ok = !isToolError(out);
  emit({ type: "tool_result", id: call.id, name: call.name, ok });
  return { callId: call.id, name: call.name, content: capResult(out), isError: !ok };
}

function capResult(out: unknown): string {
  const json = JSON.stringify(out);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return (
    json.slice(0, MAX_TOOL_RESULT_CHARS) +
    `\n[truncated: the result exceeded ${MAX_TOOL_RESULT_CHARS} characters; narrow the query]`
  );
}

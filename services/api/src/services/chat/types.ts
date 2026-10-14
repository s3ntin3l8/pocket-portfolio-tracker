import type { Logger } from "../parsers/types.js";

/** A tool as the model sees it: name, description and a JSON Schema for its input. */
export interface ChatToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ChatToolCall {
  id: string;
  name: string;
  /** Parsed JSON arguments as sent by the model; `null` when the model produced invalid JSON. */
  args: unknown;
}

export interface ChatToolResult {
  callId: string;
  name: string;
  content: string;
  isError: boolean;
}

/**
 * Provider-neutral conversation. History from the client is text only; within one request the
 * loop appends assistant turns (with their tool calls) and tool results.
 */
export type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      text: string;
      toolCalls: ChatToolCall[];
      /** Opaque provider data replayed verbatim (e.g. Anthropic content blocks incl. thinking). */
      providerState?: unknown;
    }
  | { role: "tool"; results: ChatToolResult[] };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ChatToolSpec[];
  maxTokens: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  text: string;
  toolCalls: ChatToolCall[];
  stop: "end" | "tool_use" | "max_tokens" | "refusal";
  providerState?: unknown;
}

export interface ChatProvider {
  readonly name: string;
  readonly label: string;
  /** True when data stays on the user's own infrastructure (Ollama / LM Studio). */
  readonly local: boolean;
  isConfigured(): boolean;
  complete(req: ChatRequest, log?: Logger): Promise<ChatResult>;
}

/**
 * A provider failure, reduced to a code the client may see. The upstream response body is
 * never attached: it can echo request content and must not reach the browser.
 */
export class ChatProviderError extends Error {
  constructor(
    public readonly code: "provider_error" | "provider_unreachable" | "provider_bad_response",
    public readonly status?: number,
  ) {
    super(status ? `${code} (${status})` : code);
    this.name = "ChatProviderError";
  }
}

/** Per-call upstream timeout (a tool loop makes several calls; each gets its own budget). */
export const PROVIDER_TIMEOUT_MS = 120_000;

/** Combine the caller's abort signal with the per-call timeout. */
export function withTimeout(signal: AbortSignal | undefined, ms = PROVIDER_TIMEOUT_MS) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

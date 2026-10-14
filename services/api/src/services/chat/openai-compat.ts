import {
  ChatProviderError,
  withTimeout,
  type ChatMessage,
  type ChatProvider,
  type ChatRequest,
  type ChatResult,
  type ChatToolCall,
} from "./types.js";
import type { Logger } from "../parsers/types.js";

export interface OpenAICompatOptions {
  name: string;
  label: string;
  local: boolean;
  /** Base up to and including `/v1` (e.g. https://openrouter.ai/api/v1). */
  baseUrl: string;
  model: string;
  apiKey?: string;
  fetch?: typeof fetch;
}

/**
 * Chat with tools over an OpenAI-compatible `/chat/completions` endpoint. One adapter covers
 * OpenRouter and Ollama / LM Studio. Tool-calling quality depends on the chosen model.
 */
export class OpenAICompatChatProvider implements ChatProvider {
  readonly name: string;
  readonly label: string;
  readonly local: boolean;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly doFetch: typeof fetch;

  constructor(opts: OpenAICompatOptions) {
    this.name = opts.name;
    this.label = opts.label;
    this.local = opts.local;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.doFetch = opts.fetch ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.model.length > 0;
  }

  async complete(req: ChatRequest, log?: Logger): Promise<ChatResult> {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        signal: withTimeout(req.signal),
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens,
          messages: [{ role: "system", content: req.system }, ...req.messages.flatMap(toOpenAI)],
          tools: req.tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              // Strict OpenAI-compatible servers reject the draft marker zod emits.
              parameters: stripSchemaMarker(t.inputSchema),
            },
          })),
          tool_choice: "auto",
        }),
      });
    } catch (err) {
      if (req.signal?.aborted) throw err;
      log?.error({ provider: this.name }, "chat request failed");
      throw new ChatProviderError("provider_unreachable");
    }

    if (!res.ok) {
      log?.error({ provider: this.name, status: res.status }, "chat http error");
      throw new ChatProviderError("provider_error", res.status);
    }

    const data = (await res.json().catch(() => null)) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
        };
        finish_reason?: string;
      }[];
      usage?: Record<string, unknown>;
    } | null;
    const choice = data?.choices?.[0];
    if (!choice?.message) throw new ChatProviderError("provider_bad_response");

    const toolCalls: ChatToolCall[] = (choice.message.tool_calls ?? []).map((c, i) => ({
      id: c.id || `call_${i}`,
      name: c.function?.name ?? "",
      args: parseArgs(c.function?.arguments),
    }));

    log?.info(
      {
        provider: this.name,
        model: this.model,
        stop: choice.finish_reason,
        usage: data?.usage,
        latencyMs: Date.now() - t0,
      },
      "chat turn complete",
    );
    return {
      text: choice.message.content ?? "",
      toolCalls,
      stop: toolCalls.length > 0 ? "tool_use" : mapStop(choice.finish_reason),
    };
  }
}

function mapStop(reason: string | undefined): ChatResult["stop"] {
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "refusal";
  return "end";
}

function parseArgs(raw: string | undefined): unknown {
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function stripSchemaMarker(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

function toOpenAI(m: ChatMessage): Record<string, unknown>[] {
  if (m.role === "user") return [{ role: "user", content: m.content }];
  if (m.role === "tool") {
    return m.results.map((r) => ({ role: "tool", tool_call_id: r.callId, content: r.content }));
  }
  return [
    {
      role: "assistant",
      content: m.text || null,
      ...(m.toolCalls.length > 0
        ? {
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
            })),
          }
        : {}),
    },
  ];
}

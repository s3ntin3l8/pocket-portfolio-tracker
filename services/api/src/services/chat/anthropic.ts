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

export interface AnthropicChatOptions {
  baseUrl?: string;
  model?: string;
  /** Optional `output_config.effort` (low|medium|high|xhigh|max). Omitted when unset. */
  effort?: string;
  fetch?: typeof fetch;
}

type Block = { type: string; [k: string]: unknown };

const DEFAULT_BASE_URL = "https://api.anthropic.com";

/**
 * Chat with tools over the Anthropic Messages API (raw fetch with an injectable `fetch`,
 * like the vision parser — no SDK dependency). Thinking is left at the model default; for
 * the thinking-on models the assistant turn's content blocks are replayed verbatim between
 * tool rounds (`providerState`), as the API requires.
 */
export class AnthropicChatProvider implements ChatProvider {
  readonly name = "claude";
  readonly label = "Claude (Anthropic)";
  readonly local = false;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly effort: string | undefined;
  private readonly doFetch: typeof fetch;

  constructor(
    private readonly apiKey: string,
    opts: AnthropicChatOptions = {},
  ) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.model = opts.model || "claude-opus-5-5";
    this.effort = opts.effort || undefined;
    this.doFetch = opts.fetch ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return this.apiKey.trim().length > 0;
  }

  async complete(req: ChatRequest, log?: Logger): Promise<ChatResult> {
    if (!this.isConfigured()) throw new ChatProviderError("provider_not_configured");
    const t0 = Date.now();
    // Server-side refusal fallback is a first-party-API feature: only request it there.
    const fallbacks = this.baseUrl === DEFAULT_BASE_URL;

    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          ...(fallbacks ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
        },
        signal: withTimeout(req.signal),
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens,
          system: req.system,
          ...(req.tools.length > 0
            ? {
                tools: req.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  input_schema: t.inputSchema,
                })),
              }
            : {}),
          messages: req.messages.map(toAnthropicMessage),
          ...(this.effort ? { output_config: { effort: this.effort } } : {}),
          ...(fallbacks ? { fallbacks: "default" } : {}),
        }),
      });
    } catch (err) {
      if (req.signal?.aborted) throw err;
      log?.error({ provider: this.name, err: errName(err) }, "chat request failed");
      throw new ChatProviderError("provider_unreachable");
    }

    if (!res.ok) {
      log?.error({ provider: this.name, status: res.status }, "chat http error");
      throw new ChatProviderError("provider_error", res.status);
    }

    const data = (await res.json().catch(() => null)) as {
      content?: Block[];
      stop_reason?: string;
      usage?: Record<string, unknown>;
      model?: string;
    } | null;
    if (!data || !Array.isArray(data.content)) throw new ChatProviderError("provider_bad_response");

    // `fallback` blocks are audit markers; they are not replayed.
    const content = data.content.filter((b) => b.type !== "fallback");
    const text = content
      .filter((b) => b.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("");
    const toolCalls: ChatToolCall[] = content
      .filter((b) => b.type === "tool_use")
      .map((b) => ({ id: String(b.id), name: String(b.name), args: b.input ?? null }));

    log?.info(
      {
        provider: this.name,
        model: data.model ?? this.model,
        stop: data.stop_reason,
        usage: data.usage,
        latencyMs: Date.now() - t0,
      },
      "chat turn complete",
    );
    return { text, toolCalls, stop: mapStop(data.stop_reason), providerState: { content } };
  }
}

function mapStop(reason: string | undefined): ChatResult["stop"] {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "end";
  }
}

function toAnthropicMessage(m: ChatMessage) {
  if (m.role === "user") return { role: "user", content: m.content };
  if (m.role === "tool") {
    return {
      role: "user",
      content: m.results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.callId,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  }
  const state = m.providerState as { content?: Block[] } | undefined;
  if (state?.content) return { role: "assistant", content: state.content };
  return {
    role: "assistant",
    content: [
      ...(m.text ? [{ type: "text", text: m.text }] : []),
      ...m.toolCalls.map((c) => ({
        type: "tool_use",
        id: c.id,
        name: c.name,
        input: c.args ?? {},
      })),
    ],
  };
}

const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

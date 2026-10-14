import { idleGuard, readSseFrames } from "./sse.js";
import {
  ChatProviderError,
  STREAM_IDLE_TIMEOUT_MS,
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

  private async send(
    req: ChatRequest,
    log: Logger | undefined,
    signal: AbortSignal,
    stream: boolean,
  ): Promise<Response> {
    if (!this.isConfigured()) throw new ChatProviderError("provider_not_configured");
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
        signal,
        body: JSON.stringify({
          model: this.model,
          ...(stream ? { stream: true } : {}),
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
    return res;
  }

  async complete(req: ChatRequest, log?: Logger): Promise<ChatResult> {
    const t0 = Date.now();
    const res = await this.send(req, log, withTimeout(req.signal), false);

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

  async stream(
    req: ChatRequest,
    onDelta: (text: string) => void,
    log?: Logger,
  ): Promise<ChatResult> {
    const t0 = Date.now();
    const guard = idleGuard(withTimeout(req.signal), STREAM_IDLE_TIMEOUT_MS);
    try {
      const res = await this.send(req, log, guard.signal, true);
      if (!res.body) throw new ChatProviderError("provider_bad_response");

      // Content blocks are rebuilt in order so the whole assistant turn can be replayed
      // verbatim (thinking blocks and their signatures included) between tool rounds.
      const blocks: Block[] = [];
      const toolJson = new Map<number, string>();
      let stopReason: string | undefined;
      let usage: Record<string, unknown> | undefined;
      let model: string | undefined;
      try {
        for await (const frame of readSseFrames(res.body, guard.touch)) {
          const ev = safeJson(frame.data) as StreamEvent | null;
          if (!ev) continue;
          switch (ev.type) {
            case "message_start":
              model = ev.message?.model;
              usage = ev.message?.usage;
              break;
            case "content_block_start":
              if (ev.content_block && typeof ev.index === "number") {
                const b = { ...ev.content_block };
                if (b.type === "tool_use") toolJson.set(ev.index, "");
                blocks[ev.index] = b;
              }
              break;
            case "content_block_delta": {
              const b = typeof ev.index === "number" ? blocks[ev.index] : undefined;
              const d = ev.delta;
              if (!b || !d) break;
              if (d.type === "text_delta") {
                const text = String(d.text ?? "");
                b.text = String(b.text ?? "") + text;
                if (text) onDelta(text);
              } else if (d.type === "input_json_delta") {
                toolJson.set(
                  ev.index as number,
                  (toolJson.get(ev.index as number) ?? "") + String(d.partial_json ?? ""),
                );
              } else if (d.type === "thinking_delta") {
                b.thinking = String(b.thinking ?? "") + String(d.thinking ?? "");
              } else if (d.type === "signature_delta") {
                b.signature = String(b.signature ?? "") + String(d.signature ?? "");
              }
              break;
            }
            case "content_block_stop": {
              const i = ev.index;
              if (typeof i === "number" && toolJson.has(i) && blocks[i]) {
                // Parsed only once the block is complete. Empty input means "no arguments";
                // truncated/invalid JSON becomes null so the loop refuses to run the call.
                const raw = toolJson.get(i)!.trim();
                blocks[i].input = raw === "" ? {} : safeJson(raw);
                toolJson.delete(i);
              }
              break;
            }
            case "message_delta":
              stopReason = ev.delta?.stop_reason ?? stopReason;
              if (ev.usage) usage = { ...usage, ...ev.usage };
              break;
            case "error":
              log?.error({ provider: this.name, type: ev.error?.type }, "chat stream error");
              throw new ChatProviderError("provider_error");
          }
        }
      } catch (err) {
        if (err instanceof ChatProviderError) throw err;
        if (req.signal?.aborted) throw err;
        log?.error({ provider: this.name, err: errName(err) }, "chat stream failed");
        throw new ChatProviderError("provider_unreachable");
      }

      if (!stopReason) throw new ChatProviderError("provider_bad_response");
      // A block cut off mid tool-input never saw its stop event: its input is unusable.
      for (const i of toolJson.keys()) if (blocks[i]) blocks[i].input = null;

      const content = blocks.filter((b) => b && b.type !== "fallback");
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
          model: model ?? this.model,
          stop: stopReason,
          usage,
          latencyMs: Date.now() - t0,
        },
        "chat turn complete",
      );
      return { text, toolCalls, stop: mapStop(stopReason), providerState: { content } };
    } finally {
      guard.stop();
    }
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

interface StreamEvent {
  type: string;
  index?: number;
  message?: { model?: string; usage?: Record<string, unknown> };
  content_block?: Block;
  delta?: { type?: string; stop_reason?: string; [k: string]: unknown };
  usage?: Record<string, unknown>;
  error?: { type?: string };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

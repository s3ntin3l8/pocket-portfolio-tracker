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

export interface OpenAICompatOptions {
  name: string;
  label: string;
  local: boolean;
  /** Base up to and including `/v1` (e.g. https://openrouter.ai/api/v1). */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Extra top-level request fields (e.g. OpenRouter routing preferences). */
  extraBody?: Record<string, unknown>;
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
  private readonly extraBody: Record<string, unknown>;
  private readonly doFetch: typeof fetch;

  constructor(opts: OpenAICompatOptions) {
    this.name = opts.name;
    this.label = opts.label;
    this.local = opts.local;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.extraBody = opts.extraBody ?? {};
    this.doFetch = opts.fetch ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return this.baseUrl.length > 0 && this.model.length > 0;
  }

  private async send(
    req: ChatRequest,
    log: Logger | undefined,
    signal: AbortSignal,
    stream: boolean,
  ): Promise<Response> {
    let res: Response;
    try {
      res = await this.doFetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        signal,
        body: JSON.stringify({
          model: this.model,
          ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
          max_tokens: req.maxTokens,
          messages: [{ role: "system", content: req.system }, ...req.messages.flatMap(toOpenAI)],
          ...(req.tools.length > 0
            ? {
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
              }
            : {}),
          ...this.extraBody,
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
    return res;
  }

  async complete(req: ChatRequest, log?: Logger): Promise<ChatResult> {
    const t0 = Date.now();
    const res = await this.send(req, log, withTimeout(req.signal), false);

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

      let text = "";
      let finish: string | undefined;
      let usage: Record<string, unknown> | undefined;
      let sawChoice = false;
      // Tool-call fragments arrive keyed by index: id/name once, arguments in pieces.
      const calls = new Map<number, { id?: string; name: string; args: string }>();
      try {
        for await (const frame of readSseFrames(res.body, guard.touch)) {
          if (frame.data.trim() === "[DONE]") break;
          let chunk: StreamChunk;
          try {
            chunk = JSON.parse(frame.data) as StreamChunk;
          } catch {
            continue;
          }
          if (chunk.error) {
            log?.error({ provider: this.name }, "chat stream error");
            throw new ChatProviderError("provider_error");
          }
          if (chunk.usage) usage = chunk.usage;
          const choice = chunk.choices?.[0];
          if (!choice) continue;
          sawChoice = true;
          const delta = choice.delta;
          if (delta?.content) {
            text += delta.content;
            onDelta(delta.content);
          }
          for (const tc of delta?.tool_calls ?? []) {
            // Some backends send every parallel call with index 0 (or none) but a distinct id:
            // a new id means a new call, never a continuation of the previous one.
            let i = tc.index ?? 0;
            if (tc.id && calls.get(i)?.id && calls.get(i)!.id !== tc.id) {
              i = Math.max(...calls.keys()) + 1;
            }
            const cur = calls.get(i) ?? { name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.args += tc.function.arguments;
            calls.set(i, cur);
          }
          if (choice.finish_reason) finish = choice.finish_reason;
        }
      } catch (err) {
        if (err instanceof ChatProviderError) throw err;
        if (req.signal?.aborted) throw err;
        log?.error({ provider: this.name }, "chat stream failed");
        throw new ChatProviderError("provider_unreachable");
      }
      // No finish_reason means the connection was cut: a partial turn must not look complete
      // (and its tool calls must never run).
      if (!sawChoice || !finish) throw new ChatProviderError("provider_bad_response");

      // Arguments are parsed only now that the stream is over, so a cut-off call is `null`
      // (refused by the loop) rather than run with half its input.
      const toolCalls: ChatToolCall[] = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, c], i) => ({
          id: c.id || `call_${i}`,
          name: c.name,
          args: finish === "length" ? null : parseArgs(c.args),
        }));
      log?.info(
        { provider: this.name, model: this.model, stop: finish, usage, latencyMs: Date.now() - t0 },
        "chat turn complete",
      );
      return {
        text,
        toolCalls,
        stop: toolCalls.length > 0 && finish !== "length" ? "tool_use" : mapStop(finish),
      };
    } finally {
      guard.stop();
    }
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
              // `null` = the model sent invalid JSON; servers require an object here.
              function: { name: c.name, arguments: c.args == null ? "{}" : JSON.stringify(c.args) },
            })),
          }
        : {}),
    },
  ];
}

interface StreamChunk {
  error?: unknown;
  usage?: Record<string, unknown>;
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
}

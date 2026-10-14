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

export interface GeminiChatOptions {
  baseUrl?: string;
  /** Required: there is no safe default for tool-calling quality. */
  model: string;
  fetch?: typeof fetch;
}

type Part = { [k: string]: unknown };

interface GeminiResponse {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: Record<string, unknown>;
  error?: unknown;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
/** Ids we invent for calls Gemini did not id; never sent back to the API. */
const SYNTHETIC_ID = "gemini_call_";

/**
 * Chat with tools over the Gemini API (`generateContent` / `streamGenerateContent`, raw
 * fetch with an injectable `fetch`, no SDK). The model's parts are replayed verbatim between
 * tool rounds (`providerState`) because thinking models attach a `thoughtSignature` to
 * function-call parts that must be returned unchanged.
 */
export class GeminiChatProvider implements ChatProvider {
  readonly name = "gemini";
  readonly label = "Gemini (Google)";
  readonly local = false;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly doFetch: typeof fetch;

  constructor(
    private readonly apiKey: string,
    opts: GeminiChatOptions,
  ) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.model = opts.model.replace(/^models\//, "");
    this.doFetch = opts.fetch ?? globalThis.fetch;
  }

  isConfigured(): boolean {
    return this.apiKey.trim().length > 0 && this.model.length > 0;
  }

  private async send(
    req: ChatRequest,
    log: Logger | undefined,
    signal: AbortSignal,
    stream: boolean,
  ): Promise<Response> {
    if (!this.isConfigured()) throw new ChatProviderError("provider_not_configured");
    const method = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    let res: Response;
    try {
      res = await this.doFetch(
        `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:${method}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: req.messages.map(toGeminiContent),
            ...(req.tools.length > 0
              ? {
                  tools: [
                    {
                      functionDeclarations: req.tools.map((t) => {
                        const parameters = toGeminiSchema(t.inputSchema);
                        const props = parameters.properties as Record<string, unknown> | undefined;
                        return {
                          name: t.name,
                          description: t.description,
                          // A tool without arguments takes no `parameters` at all: Gemini
                          // rejects an OBJECT schema with empty properties.
                          ...(props && Object.keys(props).length > 0 ? { parameters } : {}),
                        };
                      }),
                    },
                  ],
                }
              : {}),
            generationConfig: { maxOutputTokens: req.maxTokens },
          }),
        },
      );
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
    const data = (await res.json().catch(() => null)) as GeminiResponse | null;
    if (!data) throw new ChatProviderError("provider_bad_response");
    const turn = readTurn([data]);
    if (!turn || isBrokenTurn(turn)) throw new ChatProviderError("provider_bad_response");
    this.logTurn(log, turn, data.usageMetadata, t0);
    return toResult(turn);
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
      guard.touch(); // headers are in: from here on, silence means a dead stream
      if (!res.body) throw new ChatProviderError("provider_bad_response");
      const chunks: GeminiResponse[] = [];
      let usage: Record<string, unknown> | undefined;
      try {
        for await (const frame of readSseFrames(res.body, guard.touch)) {
          let chunk: GeminiResponse;
          try {
            chunk = JSON.parse(frame.data) as GeminiResponse;
          } catch {
            continue;
          }
          if (chunk.error) {
            log?.error({ provider: this.name }, "chat stream error");
            throw new ChatProviderError("provider_error");
          }
          chunks.push(chunk);
          if (chunk.usageMetadata) usage = chunk.usageMetadata;
          for (const p of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (typeof p.text === "string" && p.text && !p.thought) onDelta(p.text);
          }
        }
      } catch (err) {
        if (err instanceof ChatProviderError) throw err;
        if (req.signal?.aborted) throw err;
        log?.error({ provider: this.name, err: errName(err) }, "chat stream failed");
        throw new ChatProviderError("provider_unreachable");
      }
      const turn = readTurn(chunks);
      // No finish reason means the connection was cut: never treat that as a complete turn.
      if (!turn || isBrokenTurn(turn) || (!turn.finishReason && !turn.blocked)) {
        throw new ChatProviderError("provider_bad_response");
      }
      this.logTurn(log, turn, usage, t0);
      return toResult(turn);
    } finally {
      guard.stop();
    }
  }

  private logTurn(
    log: Logger | undefined,
    turn: Turn,
    usage: Record<string, unknown> | undefined,
    t0: number,
  ) {
    log?.info(
      {
        provider: this.name,
        model: this.model,
        stop: turn.finishReason ?? (turn.blocked ? "blocked" : undefined),
        usage,
        latencyMs: Date.now() - t0,
      },
      "chat turn complete",
    );
  }
}

interface Turn {
  parts: Part[];
  finishReason?: string;
  /** The prompt itself was blocked: no candidate at all. */
  blocked: boolean;
}

/** Fold one response, or the chunks of a streamed one, into a single turn. */
function readTurn(chunks: GeminiResponse[]): Turn | null {
  const parts: Part[] = [];
  let finishReason: string | undefined;
  let blocked = false;
  let sawCandidate = false;
  for (const c of chunks) {
    if (c.promptFeedback?.blockReason) blocked = true;
    const cand = c.candidates?.[0];
    if (!cand) continue;
    sawCandidate = true;
    if (cand.finishReason) finishReason = cand.finishReason;
    for (const p of cand.content?.parts ?? []) {
      const last = parts.at(-1);
      // Streamed text arrives in fragments: join plain consecutive text so the replayed
      // history is compact. Parts carrying a signature (or thought flag) stay as they are.
      if (isPlainText(p) && last && isPlainText(last)) {
        last.text = String(last.text) + String(p.text);
      } else {
        parts.push({ ...p });
      }
    }
  }
  if (!sawCandidate && !blocked) return null;
  return { parts, finishReason, blocked: blocked && !sawCandidate };
}

const isPlainText = (p: Part) =>
  typeof p.text === "string" && !p.thought && p.thoughtSignature === undefined;

/**
 * The model tried to call a tool but produced something unusable. That is a failed turn, not
 * a clean end (and not a refusal): nothing in it can be shown or run.
 */
const BROKEN_FINISH = new Set([
  "MALFORMED_FUNCTION_CALL",
  "MISSING_TOOL_PARAMS",
  "UNEXPECTED_TOOL_CALL",
]);
const isBrokenTurn = (turn: Turn) => BROKEN_FINISH.has(turn.finishReason ?? "");

function toResult(turn: Turn): ChatResult {
  const text = turn.parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => String(p.text))
    .join("");
  const toolCalls: ChatToolCall[] = [];
  for (const p of turn.parts) {
    const fc = p.functionCall as { id?: string; name?: string; args?: unknown } | undefined;
    if (!fc) continue;
    toolCalls.push({
      id: fc.id || `${SYNTHETIC_ID}${toolCalls.length}`,
      name: fc.name ?? "",
      args: fc.args ?? {},
    });
  }
  return {
    text,
    toolCalls,
    stop: turn.blocked ? "refusal" : mapStop(turn.finishReason, toolCalls.length > 0),
    providerState: { parts: turn.parts },
  };
}

function mapStop(reason: string | undefined, hasToolCalls: boolean): ChatResult["stop"] {
  switch (reason) {
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "RECITATION":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "IMAGE_SAFETY":
      return "refusal";
    default:
      return hasToolCalls ? "tool_use" : "end";
  }
}

function toGeminiContent(m: ChatMessage) {
  if (m.role === "user") return { role: "user", parts: [{ text: m.content }] };
  if (m.role === "tool") {
    return {
      role: "user",
      parts: m.results.map((r) => ({
        functionResponse: {
          name: r.name,
          ...(r.callId.startsWith(SYNTHETIC_ID) ? {} : { id: r.callId }),
          // The API wants an object; tool results are JSON text.
          response: r.isError ? { error: parseJson(r.content) } : { result: parseJson(r.content) },
        },
      })),
    };
  }
  const state = m.providerState as { parts?: Part[] } | undefined;
  if (state?.parts) return { role: "model", parts: state.parts };
  return {
    role: "model",
    parts: [
      ...(m.text ? [{ text: m.text }] : []),
      ...m.toolCalls.map((c) => ({ functionCall: { name: c.name, args: c.args ?? {} } })),
    ],
  };
}

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

const SCHEMA_KEYS = new Set([
  "type",
  "description",
  "enum",
  "format",
  "nullable",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "required",
]);

/**
 * JSON Schema (as zod emits it) -> the OpenAPI subset Gemini's `parameters` accepts. Unknown
 * keywords make the API reject the whole request, so only known ones pass; `["x","null"]`
 * types become `nullable`, and a nullable `anyOf` collapses to its non-null branch.
 */
export function toGeminiSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const branches = (s.anyOf ?? s.oneOf) as unknown[];
    const real = branches.filter((b) => (b as { type?: unknown })?.type !== "null");
    if (real.length === 1) {
      Object.assign(out, toGeminiSchema(real[0]));
    } else if (real.length > 1) {
      out.anyOf = real.map(toGeminiSchema); // Gemini supports anyOf natively
    }
    if (real.length !== branches.length) out.nullable = true;
  }
  for (const [k, v] of Object.entries(s)) {
    if (!SCHEMA_KEYS.has(k)) continue;
    if (k === "type" && Array.isArray(v)) {
      const types = v.filter((t) => t !== "null");
      if (types.length === 1) out.type = types[0];
      if (types.length !== v.length) out.nullable = true;
    } else if (k === "required") {
      if (Array.isArray(v) && v.length > 0) out.required = v;
    } else {
      out[k] = v;
    }
  }
  if (s.properties && typeof s.properties === "object") {
    out.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
  }
  if (s.items) out.items = toGeminiSchema(s.items);
  return out;
}

const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

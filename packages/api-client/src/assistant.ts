/** In-app assistant (chat): wire types and the Server-Sent Events reader. See docs/assistant.md. */

export interface AssistantStatus {
  available: boolean;
  /** Provider id (`claude`, `openrouter`, `ollama`), or null when chat is unavailable. */
  provider: string | null;
  label: string | null;
  /** True when data never leaves the user's own infrastructure. */
  local: boolean;
  /** The user opted in to keeping conversations (and this credential may write them). */
  saveHistory?: boolean;
}

export interface AssistantConversationSummary {
  id: string;
  title: string;
  scope: string | null;
  updatedAt: string;
  messageCount: number;
}

export interface AssistantConversation {
  id: string;
  title: string;
  scope: string | null;
  updatedAt: string;
  messages: AssistantChatMessage[];
}

export interface AssistantChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantChatRequest {
  /** Must start and end with a user message (≤ 20 messages, ≤ 4000 chars each). */
  messages: AssistantChatMessage[];
  /** `all`, `p:<portfolio id>` or `h:<holder id>` — what the user is currently viewing. */
  scope?: string;
  /** Append the turn to this stored conversation (history on); omit to start a new one. */
  conversationId?: string;
}

/**
 * One event of the chat stream. Within a model turn all `tool_call`s come first (in call
 * order), then the `tool_result`s in the same order; pair them by `id`. `delta` is a text
 * fragment of the turn being generated; `message` is that turn's complete text and marks it
 * finished (it supersedes the deltas, which are only a preview). `error` ends the stream;
 * `done` is the normal end.
 */
export type AssistantEvent =
  | { type: "status"; provider: string; local: boolean }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean }
  | { type: "delta"; text: string }
  | { type: "message"; text: string }
  | { type: "conversation"; id: string; saved: boolean }
  | { type: "error"; error: string; status?: number }
  | { type: "done"; rounds: number };

/** A frame with no delimiter must not grow without bound (the server never sends one this big).
 *  Measured in UTF-16 code units (`string.length`), which is plenty for the threat model. */
const MAX_FRAME_CHARS = 1_000_000;

const EVENT_TYPES = new Set<AssistantEvent["type"]>([
  "status",
  "tool_call",
  "tool_result",
  "delta",
  "message",
  "conversation",
  "error",
  "done",
]);

/** Parse one SSE frame (the text between blank lines); null for comments and unknown events. */
function parseFrame(frame: string): AssistantEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue; // keep-alive / comment
    const i = line.indexOf(":");
    const field = i === -1 ? line : line.slice(0, i);
    const value = i === -1 ? "" : line.slice(i + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  if (data.length === 0 || !EVENT_TYPES.has(event as AssistantEvent["type"])) return null;
  try {
    const payload = JSON.parse(data.join("\n")) as Record<string, unknown>;
    // `type` last: the SSE event name decides, whatever the payload carries.
    return { ...payload, type: event } as AssistantEvent;
  } catch {
    return null; // a malformed frame must not kill the stream
  }
}

/**
 * Read an assistant SSE body into typed events. Handles frames split across chunks (also in
 * the middle of a multi-byte character), CRLF line endings, keep-alive comments, a final
 * frame without a trailing blank line, and ignores unknown event types (forward-compatible).
 * Stops reading (and cancels the body) when the consumer stops iterating.
 */
export async function* parseAssistantStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AssistantEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      if (buffer.length > MAX_FRAME_CHARS) throw new Error("assistant_stream_frame_too_large");
      for (const frame of frames) {
        const event = parseFrame(frame);
        if (event) yield event;
      }
      if (done) break;
    }
    const last = parseFrame(buffer);
    if (last) yield last;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

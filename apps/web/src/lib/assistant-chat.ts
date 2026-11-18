import { ApiError, apiErrorCode } from "@portfolio/api-client";
import type {
  AssistantAttachment,
  AssistantChatRequestMessage,
  AssistantEvent,
} from "@portfolio/api-client";
import { formatScopeParam, parseCookieScope, parseScopeParam } from "@/lib/portfolio-selection";

/** Mirror the API's request caps (docs/assistant.md) so a long chat never fails with a 400. */
export const MAX_HISTORY_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 4000;

export interface ToolStep {
  id: string;
  name: string;
  status: "running" | "done" | "failed";
}

/** A file shown on a user turn. Only its name is kept here; the bytes live in the chat hook. */
export interface TurnAttachment {
  name: string;
  /** True for a turn reopened from History: the file was never stored and must be attached again. */
  reattach?: boolean;
}

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Documents attached to this user turn (names only; see {@link TurnAttachment}). */
  attachments?: TurnAttachment[];
  /** Text of the model turn still being generated (a preview; `message` replaces it). */
  streaming?: string;
  /** The model's latest progress note ("what I'm doing"); shown until the answer text starts. */
  progress?: string;
  /** Tool calls the assistant made while answering (assistant turns only). */
  steps: ToolStep[];
  /** An i18n key under `Assistant.errors` when this turn ended in a failure. */
  error?: string;
  /** True while the answer is still streaming in. */
  pending?: boolean;
  /** True when the user stopped the answer (it keeps whatever had arrived). */
  stopped?: boolean;
}

/** The `📎 name` lines the API stores after a turn's text instead of the file (docs/assistant.md). */
const MARKER_LINE = /\n📎 ([^\n]+)/g;

/**
 * Split a stored user message into its text and the names of the files that were attached. The
 * files themselves are never stored, so each comes back flagged `reattach`.
 */
export function splitAttachmentMarkers(content: string): {
  content: string;
  attachments?: TurnAttachment[];
} {
  const names = [...content.matchAll(MARKER_LINE)].map((m) => m[1]!.trim());
  if (names.length === 0) return { content };
  return {
    content: content.replace(MARKER_LINE, ""),
    attachments: names.map((name) => ({ name, reattach: true })),
  };
}

/**
 * The conversation as the API wants it: text, plus the files still held in memory for a turn
 * (resent so a follow-up still sees the document), the last {@link MAX_HISTORY_MESSAGES},
 * starting with a user message. Tool context is not replayed. Turns that produced no text
 * (a failed or stopped answer) are left out so they don't poison the next request.
 */
export function toRequestMessages(
  turns: ChatTurn[],
  files: ReadonlyMap<string, AssistantAttachment[]> = new Map(),
): AssistantChatRequestMessage[] {
  const messages = turns
    .filter((t) => !t.pending && t.content.trim().length > 0)
    .map((t) => {
      const attached = t.role === "user" ? files.get(t.id) : undefined;
      return {
        role: t.role,
        content: t.content.slice(0, MAX_MESSAGE_CHARS),
        ...(attached?.length ? { attachments: attached } : {}),
      };
    });
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);
  while (recent.length > 0 && recent[0]!.role !== "user") recent.shift();
  return recent;
}

/** Fold one stream event into the assistant turn it belongs to. */
export function applyEvent(turn: ChatTurn, event: AssistantEvent): ChatTurn {
  switch (event.type) {
    case "thinking":
      return { ...turn, progress: event.text };
    case "delta":
      return { ...turn, progress: undefined, streaming: (turn.streaming ?? "") + event.text };
    case "message":
      // A turn with tool calls can produce several model messages; keep them as paragraphs.
      return {
        ...turn,
        progress: undefined,
        streaming: undefined,
        content: turn.content ? `${turn.content}\n\n${event.text}` : event.text,
      };
    case "tool_call":
      return {
        ...turn,
        steps: [...turn.steps, { id: event.id, name: event.name, status: "running" }],
      };
    case "tool_result":
      return {
        ...turn,
        steps: turn.steps.map((s) =>
          s.id === event.id ? { ...s, status: event.ok ? "done" : "failed" } : s,
        ),
      };
    case "error":
      return { ...turn, error: errorKey(event.error) };
    default:
      return turn; // status / done carry nothing to show
  }
}

/** The text to show for a turn: finished messages plus the one still streaming in. */
export function displayText(turn: ChatTurn): string {
  if (!turn.streaming) return turn.content;
  return turn.content ? `${turn.content}\n\n${turn.streaming}` : turn.streaming;
}

/**
 * End of a stream: a partial turn the user stopped (or that was cut off) keeps the text that
 * had arrived, so it shows the same afterwards and is part of the history sent next.
 */
export function settleTurn(turn: ChatTurn): ChatTurn {
  if (!turn.streaming) return turn;
  return { ...turn, content: displayText(turn), streaming: undefined };
}

const KNOWN_ERRORS = new Set([
  "provider_error",
  "provider_unreachable",
  "provider_bad_response",
  "provider_not_configured",
  "refused",
  "truncated",
  "too_many_tool_rounds",
  "chat_failed",
  "assistant_rate_limited",
  "chat_not_configured",
  "invalid_request",
  "attachments_disabled",
  "attachment_unsupported",
]);

/** Map a server error code to an `Assistant.errors` key; anything unexpected is `generic`. */
export function errorKey(code: string): string {
  return KNOWN_ERRORS.has(code) ? code : "generic";
}

/** Map a failure before the stream started (HTTP status) or a network error to a key. */
export function errorKeyFor(err: unknown): string {
  if (err instanceof ApiError) {
    // The api client already routes a lost session to sign-in; this is the message while it does.
    if (err.status === 401) return "unauthorized";
    if (err.status === 429) return "assistant_rate_limited";
    if (err.status === 503) return "chat_not_configured";
    if (err.status === 400) {
      const code = apiErrorCode(err);
      return code === "attachments_disabled" || code === "attachment_unsupported"
        ? code
        : "invalid_request";
    }
    return "chat_failed";
  }
  return "network";
}

/**
 * The scope the user is looking at, in the API's grammar (`all | p:<id> | h:<id>`): the URL's
 * `?scope=` when present (read at call time, so it is never stale), else the scope the layout
 * rendered for (the `pf` cookie encoding).
 */
export function currentScope(search: string, serverScope: string | null): string {
  const fromUrl = parseScopeParam(new URLSearchParams(search).get("scope"));
  return formatScopeParam(fromUrl ?? parseCookieScope(serverScope));
}

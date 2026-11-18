import { ChatProviderError } from "./types.js";
import type { ChatMessage, ChatProvider, ChatRequest, ChatResult } from "./types.js";

/**
 * A scripted chat provider for the visual demo: no network, no key, no randomness. It exists so
 * `make visual-check` can render the assistant panel in every state, and is reachable only through
 * `demoChatProviderFromEnv`, which refuses to run against anything but an embedded PGlite database.
 *
 * Questions (the text of the last user message) pick a script:
 *  - OVERVIEW_QUESTION: a progress note, one real `get_net_worth` call, then a fixed answer.
 *  - HOLD_QUESTION: a progress note, then it waits until the client aborts, so a scene can capture
 *    the panel mid-answer. It never answers.
 *  - anything else: a fixed short answer.
 */
export const OVERVIEW_QUESTION = "How is my portfolio doing?";
export const HOLD_QUESTION = "What is driving my gains?";

export const STUB_THINKING_NOTE = "Looking at your net worth and what changed this year.";
export const STUB_ANSWER =
  "Your portfolio is **up** over the period, driven mostly by your equity holdings.\n\n" +
  "- Gains are measured *vs cost of holdings*.\n" +
  "- Cash is shown separately.\n\n" +
  "This is a demo answer: nothing here comes from a model.";

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user") return m.content;
  }
  return "";
}

/** How long the hold question waits for the client before giving up, like a dead upstream would. */
const DEFAULT_HOLD_MS = 120_000;

/**
 * Rejects when `signal` aborts (like a real aborted request), or after `holdMs` when nothing
 * aborts it, so a held turn can never keep a request open forever.
 */
function untilAborted(signal: AbortSignal | undefined, holdMs: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(fail, holdMs);
    timer.unref?.();
    function fail() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", fail);
      reject(new ChatProviderError("provider_unreachable"));
    }
    if (signal?.aborted) fail();
    else signal?.addEventListener("abort", fail, { once: true });
  });
}

export function createDemoChatProvider({
  holdMs = DEFAULT_HOLD_MS,
}: { holdMs?: number } = {}): ChatProvider {
  async function run(req: ChatRequest, onThinking?: (text: string) => void): Promise<ChatResult> {
    const last = req.messages[req.messages.length - 1];
    // After the tool ran, the one thing left is the answer.
    if (last?.role === "tool") return { text: STUB_ANSWER, toolCalls: [], stop: "end" };

    const question = lastUserText(req.messages);
    if (question === HOLD_QUESTION) {
      onThinking?.(STUB_THINKING_NOTE);
      return untilAborted(req.signal, holdMs);
    }
    if (question === OVERVIEW_QUESTION) {
      onThinking?.(STUB_THINKING_NOTE);
      return {
        text: "",
        toolCalls: [{ id: "demo-call-1", name: "get_net_worth", args: {} }],
        stop: "tool_use",
      };
    }
    return { text: STUB_ANSWER, toolCalls: [], stop: "end" };
  }

  return {
    name: "demo",
    label: "Demo",
    local: true,
    isConfigured: () => true,
    complete: (req) => run(req),
    async stream(req, onDelta, _log, onThinking) {
      const result = await run(req, onThinking);
      if (result.text) onDelta(result.text);
      return result;
    },
  };
}

/**
 * The stub when `DEMO_CHAT_STUB=1`, else null (the normal provider resolution applies). Throws when
 * the flag is set against a database that is not an embedded `pglite://` one, so a stray variable
 * on a real deployment fails loudly at startup instead of answering with scripted text.
 */
export function demoChatProviderFromEnv(
  env: Record<string, string | undefined> = process.env,
): ChatProvider | null {
  if (env.DEMO_CHAT_STUB !== "1") return null;
  if (!env.DATABASE_URL?.startsWith("pglite://")) {
    throw new Error("DEMO_CHAT_STUB is only allowed with an embedded pglite:// DATABASE_URL");
  }
  return createDemoChatProvider();
}

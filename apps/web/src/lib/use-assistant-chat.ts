"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "@portfolio/api-client";
import {
  applyEvent,
  errorKeyFor,
  MAX_MESSAGE_CHARS,
  toRequestMessages,
  type ChatTurn,
} from "@/lib/assistant-chat";

type ChatClient = Pick<ApiClient, "streamAssistantChat">;

let nextId = 0;
const newId = () => `t${++nextId}`;

/**
 * Chat state for the assistant panel. The conversation lives only in memory (nothing is stored
 * server-side); `send` streams one answer, `stop` cancels it — the abort travels through the
 * proxy to the API, which stops the model call. Turns are kept in a ref so a send always sees
 * the latest history regardless of render timing.
 */
export function useAssistantChat(client: ChatClient, getScope: () => string) {
  const turnsRef = useRef<ChatTurn[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);

  const commit = useCallback((next: ChatTurn[]) => {
    turnsRef.current = next;
    setTurns(next);
  }, []);

  const patchLast = useCallback(
    (fn: (t: ChatTurn) => ChatTurn) => {
      const list = turnsRef.current;
      if (list.length === 0) return;
      commit([...list.slice(0, -1), fn(list[list.length - 1]!)]);
    },
    [commit],
  );

  /** Starts an answer; returns false (and does nothing) when one is already streaming. */
  const send = useCallback(
    (raw: string): boolean => {
      const text = raw.trim().slice(0, MAX_MESSAGE_CHARS);
      if (!text || abortRef.current) return false;

      const history = [
        ...turnsRef.current,
        { id: newId(), role: "user", content: text, steps: [] } satisfies ChatTurn,
      ];
      const request = toRequestMessages(history);
      commit([
        ...history,
        { id: newId(), role: "assistant", content: "", steps: [], pending: true },
      ]);

      const ac = new AbortController();
      abortRef.current = ac;
      setStreaming(true);
      // `abortRef.current !== ac` means this send was superseded (New chat, then a new
      // question): its late events must not touch the new conversation or its controller.
      const current = () => abortRef.current === ac;
      void (async () => {
        let sawDone = false;
        try {
          for await (const event of client.streamAssistantChat(
            { messages: request, scope: getScope() },
            { signal: ac.signal },
          )) {
            if (!current()) break;
            if (event.type === "done") sawDone = true;
            patchLast((t) => applyEvent(t, event));
          }
          // A stream that ends without `done` or an error was cut off; one that ends with
          // nothing to show would otherwise leave an empty bubble.
          if (current() && !ac.signal.aborted) {
            patchLast((t) =>
              t.error
                ? t
                : !sawDone
                  ? { ...t, error: "interrupted" }
                  : t.content
                    ? t
                    : { ...t, error: "empty" },
            );
          }
        } catch (err) {
          if (!ac.signal.aborted && current()) {
            patchLast((t) => ({ ...t, error: errorKeyFor(err) }));
          }
        } finally {
          if (current()) {
            // A Stop that lands after the answer already finished is not a stopped answer.
            const stopped = ac.signal.aborted && !sawDone;
            abortRef.current = null;
            setStreaming(false);
            patchLast((t) => ({ ...t, pending: false, ...(stopped ? { stopped: true } : {}) }));
          }
        }
      })();
      return true;
    },
    [client, commit, getScope, patchLast],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    commit([]);
  }, [commit]);

  // Leaving the app shell cancels any in-flight answer. React StrictMode (dev) unmounts and
  // remounts immediately, which must not kill a request started on mount (e.g. a seeded
  // "Explain" question) — so only abort if we are still unmounted after the remount window.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      setTimeout(() => {
        if (!mountedRef.current) abortRef.current?.abort();
      }, 0);
    };
  }, []);

  return { turns, streaming, send, stop, reset };
}

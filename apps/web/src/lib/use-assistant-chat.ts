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

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim().slice(0, MAX_MESSAGE_CHARS);
      if (!text || abortRef.current) return;

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
      try {
        for await (const event of client.streamAssistantChat(
          { messages: request, scope: getScope() },
          { signal: ac.signal },
        )) {
          patchLast((t) => applyEvent(t, event));
        }
      } catch (err) {
        if (!ac.signal.aborted) patchLast((t) => ({ ...t, error: errorKeyFor(err) }));
      } finally {
        abortRef.current = null;
        setStreaming(false);
        patchLast((t) => ({ ...t, pending: false }));
      }
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

  // Leaving the app shell cancels any in-flight answer.
  useEffect(() => () => abortRef.current?.abort(), []);

  return { turns, streaming, send, stop, reset };
}

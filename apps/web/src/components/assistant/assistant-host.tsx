"use client";

import { useCallback, useEffect, useRef } from "react";
import type { AssistantStatus } from "@portfolio/api-client";
import { AssistantDialog } from "@/components/assistant/assistant-dialog";
import { useApiClient } from "@/lib/api";
import { currentScope } from "@/lib/assistant-chat";
import { useAssistantChat } from "@/lib/use-assistant-chat";

export interface AssistantSeed {
  id: number;
  text: string;
}

/**
 * Owns the conversation (so it survives closing and reopening the panel) and renders the
 * dialog. Loaded lazily the first time the assistant is opened, so none of this — nor the
 * markdown renderer — is in the initial bundle.
 */
export default function AssistantHost({
  open,
  onOpenChange,
  status,
  seed,
  serverScope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: AssistantStatus | null;
  /** A question to send as soon as the panel opens (e.g. from an "Explain" button). */
  seed: AssistantSeed | null;
  serverScope: string | null;
}) {
  const client = useApiClient();
  // Read at send time, so the scope is whatever the user is looking at right now.
  const getScope = useCallback(
    () => currentScope(window.location.search, serverScope),
    [serverScope],
  );
  const chat = useAssistantChat(client, getScope);

  // A seeded question waits for a running answer to finish rather than being dropped; it is
  // marked handled only once a send was actually accepted (so StrictMode can't double-send).
  const handledSeed = useRef(0);
  const { send, streaming } = chat;
  useEffect(() => {
    if (!seed || seed.id === handledSeed.current || streaming) return;
    if (send(seed.text)) handledSeed.current = seed.id;
  }, [seed, send, streaming]);

  return <AssistantDialog open={open} onOpenChange={onOpenChange} chat={chat} status={status} />;
}

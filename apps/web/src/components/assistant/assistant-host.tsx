"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AssistantStatus } from "@portfolio/api-client";
import { AssistantDialog } from "@/components/assistant/assistant-dialog";
import { AssistantDock } from "@/components/assistant/assistant-dock";
import type { AssistantPanelState } from "@/components/assistant/assistant-panel";
import { useApiClient } from "@/lib/api";
import { currentScope } from "@/lib/assistant-chat";
import { useAssistantChat } from "@/lib/use-assistant-chat";
import { useComposerAttachments } from "@/lib/use-composer-attachments";
import { useMediaQuery } from "@/lib/use-media-query";

export interface AssistantSeed {
  id: number;
  /** A question to send as soon as the panel opens. */
  text?: string;
  /** Text to leave in the composer, unsent. */
  prefill?: string;
  /** Scope for this conversation, overriding the URL's. */
  scope?: string;
}

const WIDE_KEY = "pocket.assistant.wide";

function readWide(): boolean {
  try {
    return window.localStorage.getItem(WIDE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Owns the conversation (so it survives closing and reopening the panel, and a resize between the
 * phone dialog and the desktop dock) and renders the right container. Loaded lazily the first time
 * the assistant is opened, so none of this, nor the markdown renderer, is in the initial bundle.
 */
export default function AssistantHost({
  open,
  onOpenChange,
  status,
  seed,
  serverScope,
  slot,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: AssistantStatus | null;
  /** A question to send, or text to prefill, as soon as the panel opens. */
  seed: AssistantSeed | null;
  serverScope: string | null;
  /** The shell's dock slot; without one the panel is always the dialog. */
  slot: HTMLElement | null;
}) {
  const client = useApiClient();
  // A hand-off (e.g. from Add transaction) can pin the conversation to one portfolio.
  const scopeOverride = useRef<string | null>(null);
  // Read at send time, so the scope is whatever the user is looking at right now.
  const getScope = useCallback(
    () => scopeOverride.current ?? currentScope(window.location.search, serverScope),
    [serverScope],
  );
  const chat = useAssistantChat(client, getScope);
  // Files the conversation already carries count against the API's cap of 3 per conversation.
  const sentFiles = chat.turns.reduce(
    (n, t) => n + (t.attachments?.filter((a) => !a.reattach).length ?? 0),
    0,
  );
  const attachments = useComposerAttachments(status?.attachments, sentFiles);
  const clearAttachments = attachments.clear;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [wide, setWide] = useState(readWide);
  // Kept here (not in the panel) so turning saving on survives a resize between dock and dialog.
  const [savingEnabled, setSavingEnabled] = useState(false);
  const docked = useMediaQuery("(min-width: 768px)") && slot !== null;

  // A seeded question waits for a running answer to finish rather than being dropped; it is
  // marked handled only once a send was actually accepted (so StrictMode can't double-send).
  const handledSeed = useRef(0);
  const { send, streaming } = chat;
  useEffect(() => {
    if (!seed?.text || seed.id === handledSeed.current || streaming) return;
    // Whatever opened the panel states the scope: a question from elsewhere (the gain explainer)
    // must not inherit a hand-off's portfolio pin.
    scopeOverride.current = seed.scope ?? null;
    if (send(seed.text)) handledSeed.current = seed.id;
  }, [seed, send, streaming]);

  // The pin lasts as long as the panel is open, however it was closed (×, Esc, the top-bar button).
  useEffect(() => {
    if (!open) scopeOverride.current = null;
  }, [open]);

  // Prefill goes into the composer, never sent: the user completes it.
  const handledPrefill = useRef(0);
  useEffect(() => {
    if (!seed?.prefill || seed.id === handledPrefill.current) return;
    handledPrefill.current = seed.id;
    scopeOverride.current = seed.scope ?? null;
    // An unsent draft is kept: the starter goes in front of it rather than replacing it.
    const prefill = seed.prefill;
    setDraft((current) => (current.trim() ? `${prefill}${current}` : prefill));
    setShowHistory(false);
    inputRef.current?.focus();
  }, [seed]);

  // A scope with nothing to send or prefill still pins the conversation.
  const handledScopeOnly = useRef(0);
  useEffect(() => {
    if (!seed || seed.text || seed.prefill || !seed.scope) return;
    if (seed.id === handledScopeOnly.current) return;
    handledScopeOnly.current = seed.id;
    scopeOverride.current = seed.scope;
  }, [seed]);

  const enableHistory = useCallback(async () => {
    try {
      await client.putPreferences({ assistantSaveHistory: true });
      setSavingEnabled(true);
      return true;
    } catch {
      return false;
    }
  }, [client]);

  const close = onOpenChange;

  // Stable between renders: the History list refetches whenever this object changes. A reopened
  // conversation is not about the portfolio a hand-off pinned, so opening one drops the pin.
  const sourceHistory = chat.history;
  const history = useMemo(
    () =>
      sourceHistory
        ? {
            ...sourceHistory,
            open: async (id: string) => {
              const ok = await sourceHistory.open(id);
              if (ok) scopeOverride.current = null;
              return ok;
            },
          }
        : sourceHistory,
    [sourceHistory],
  );

  const state: AssistantPanelState = {
    chat: {
      ...chat,
      reset: () => {
        scopeOverride.current = null;
        clearAttachments();
        chat.reset();
      },
      history,
    },
    status,
    enableHistory,
    savingEnabled,
    draft,
    setDraft,
    showHistory,
    setShowHistory,
    inputRef,
    attachments,
  };

  if (docked) {
    return open
      ? createPortal(
          <AssistantDock
            state={state}
            onClose={() => close(false)}
            wide={wide}
            onToggleWide={() => {
              const next = !wide;
              setWide(next);
              try {
                window.localStorage.setItem(WIDE_KEY, next ? "1" : "0");
              } catch {
                // Private mode: the preference just doesn't persist.
              }
            }}
          />,
          slot,
        )
      : null;
  }
  return <AssistantDialog open={open} onOpenChange={close} state={state} />;
}

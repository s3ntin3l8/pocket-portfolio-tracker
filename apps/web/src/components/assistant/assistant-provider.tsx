"use client";

import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AssistantStatus } from "@portfolio/api-client";
import { useApiClient } from "@/lib/api";

const AssistantHost = lazy(() => import("@/components/assistant/assistant-host"));

/** What an entry point asks the panel to do when it opens. */
export interface AssistantOpenOptions {
  /** A question to send right away. */
  question?: string;
  /** Text to put in the composer without sending it (the user finishes it). */
  prefill?: string;
  /** Scope for this conversation (`p:<portfolio id>`), instead of what the URL shows. */
  scope?: string;
}

interface AssistantContextValue {
  /** True once the API reports a configured chat provider. */
  available: boolean;
  /** Whether the panel is showing. */
  isOpen: boolean;
  /** Open the panel: a string is a question to send straight away. */
  open: (arg?: string | AssistantOpenOptions) => void;
  /** Close the panel; the conversation is kept. */
  close: () => void;
}

const AssistantContext = createContext<AssistantContextValue>({
  available: false,
  isOpen: false,
  open: () => {},
  close: () => {},
});

/** The shell's flex row registers its slot here, so the dock sits beside the page. */
const AssistantSlotContext = createContext<(el: HTMLElement | null) => void>(() => {});

/** Entry points call this; outside the provider (or when chat is unconfigured) they hide. */
export function useAssistant(): AssistantContextValue {
  return useContext(AssistantContext);
}

/**
 * Where the desktop dock mounts: place it as a child of the shell's flex row, after the page
 * column. It renders nothing itself (`display: contents`); the dock is portaled in.
 */
export function AssistantSlot() {
  const setSlot = useContext(AssistantSlotContext);
  return <div ref={setSlot} className="contents" />;
}

/**
 * Mounted once in the app shell. Asks the API whether the assistant is available (nothing is
 * shown when it isn't, or when the lookup fails) and lazily loads the chat panel on first use.
 */
export function AssistantProvider({
  serverScope,
  children,
}: {
  serverScope: string | null;
  children: React.ReactNode;
}) {
  const client = useApiClient();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [seed, setSeed] = useState<{
    id: number;
    text?: string;
    prefill?: string;
    scope?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .getAssistantStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null));
    return () => {
      cancelled = true;
    };
  }, [client]);

  const available = status?.available === true;
  const openAssistant = useCallback((arg?: string | AssistantOpenOptions) => {
    setLoaded(true);
    setOpen(true);
    const options = typeof arg === "string" ? { question: arg } : (arg ?? {});
    if (options.question || options.prefill) {
      setSeed((s) => ({
        id: (s?.id ?? 0) + 1,
        text: options.question,
        prefill: options.prefill,
        scope: options.scope,
      }));
    }
  }, []);
  const closeAssistant = useCallback(() => setOpen(false), []);
  const value = useMemo(
    () => ({ available, isOpen: open, open: openAssistant, close: closeAssistant }),
    [available, open, openAssistant, closeAssistant],
  );

  return (
    <AssistantContext.Provider value={value}>
      <AssistantSlotContext.Provider value={setSlot}>
        {children}
        {available && loaded && (
          <Suspense fallback={null}>
            <AssistantHost
              open={open}
              onOpenChange={setOpen}
              status={status}
              seed={seed}
              serverScope={serverScope}
              slot={slot}
            />
          </Suspense>
        )}
      </AssistantSlotContext.Provider>
    </AssistantContext.Provider>
  );
}

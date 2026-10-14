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

interface AssistantContextValue {
  /** True once the API reports a configured chat provider. */
  available: boolean;
  /** Open the panel, optionally sending a question straight away. */
  open: (question?: string) => void;
}

const AssistantContext = createContext<AssistantContextValue>({
  available: false,
  open: () => {},
});

/** Entry points call this; outside the provider (or when chat is unconfigured) they hide. */
export function useAssistant(): AssistantContextValue {
  return useContext(AssistantContext);
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
  const [seed, setSeed] = useState<{ id: number; text: string } | null>(null);

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
  const openAssistant = useCallback((question?: string) => {
    setLoaded(true);
    setOpen(true);
    if (question) setSeed((s) => ({ id: (s?.id ?? 0) + 1, text: question }));
  }, []);
  const value = useMemo(() => ({ available, open: openAssistant }), [available, openAssistant]);

  return (
    <AssistantContext.Provider value={value}>
      {children}
      {available && loaded && (
        <Suspense fallback={null}>
          <AssistantHost
            open={open}
            onOpenChange={setOpen}
            status={status}
            seed={seed}
            serverScope={serverScope}
          />
        </Suspense>
      )}
    </AssistantContext.Provider>
  );
}

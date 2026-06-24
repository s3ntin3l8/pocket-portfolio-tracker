"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 300_000;

export function IbkrSyncButton({ initialSyncing = false }: { initialSyncing?: boolean }) {
  const t = useTranslations("InteractiveBrokers");
  const api = useApiClient();
  const router = useRouter();
  const [syncing, setSyncing] = useState(initialSyncing);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (initialSyncing) startPolling();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopPolling() {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling() {
    stopPolling();
    startRef.current = Date.now();
    pollRef.current = setInterval(() => void poll(), POLL_INTERVAL_MS);
  }

  async function poll() {
    if (Date.now() - startRef.current > POLL_TIMEOUT_MS) {
      stopPolling();
      setSyncing(false);
      toast.error(t("errors.ibkr_sync_failed"));
      return;
    }
    try {
      const conn = await api.getIbkrConnection();
      if (!conn.syncing) {
        stopPolling();
        setSyncing(false);
        if (conn.lastError) {
          toast.error(conn.lastError);
        } else {
          router.refresh();
        }
      }
    } catch {
      // transient — keep polling
    }
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    try {
      await api.syncIbkr();
      startPolling();
    } catch {
      setSyncing(false);
      toast.error(t("errors.ibkr_sync_failed"));
    }
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={t("syncNow")}
      onClick={handleSync}
      disabled={syncing}
    >
      <RefreshCw className={`size-4${syncing ? " animate-spin" : ""}`} />
    </Button>
  );
}

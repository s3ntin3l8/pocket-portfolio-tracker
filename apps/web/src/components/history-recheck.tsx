"use client";

import { useApiClient } from "@/lib/api";
import { HistoryRecheckPanel } from "@/components/history-recheck-panel";

/** Client wrapper: binds the session-aware api-client to the price-history re-check panel. */
export function HistoryRecheck() {
  const api = useApiClient();
  return <HistoryRecheckPanel client={api} />;
}

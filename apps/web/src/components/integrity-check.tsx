"use client";

import { IntegrityCheckPanel } from "@/components/integrity-check-panel";
import { useApiClient } from "@/lib/api";

/** Client wrapper: binds the session-aware api-client to the data-check panel. */
export function IntegrityCheck() {
  const api = useApiClient();
  return <IntegrityCheckPanel client={api} />;
}

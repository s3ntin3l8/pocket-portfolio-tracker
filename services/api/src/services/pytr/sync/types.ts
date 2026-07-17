import type { FastifyBaseLogger } from "fastify";
import type { ImportIssue, ParsedTransaction } from "@portfolio/schema";
import type { CashReconciliation } from "../reconcile.js";

export type { CashReconciliation };

export interface SyncResult {
  status: "connected" | "expired" | "error";
  importId?: string;
  drafts?: number;
  errors?: number;
  /** Confirmed transactions removed because their source event was cancelled. */
  cancelled?: number;
  /** TR's reported cash vs our derived cash, per currency (when TR reported a balance). */
  reconciliation?: CashReconciliation;
  /** How many postbox PDFs were requested this sync (only set when documentRetention=true). */
  documentsRequested?: number;
  /** How many postbox PDFs were successfully stored this sync. */
  documentsStored?: number;
  /** How many account-level report documents (e.g. the annual tax report) were requested. */
  reportDocumentsRequested?: number;
  /** How many account-level report documents were successfully stored this sync. */
  reportDocumentsStored?: number;
}

// The parsed_json shape of a pytr "collector" draft: the single open draft per connection
// that accumulates only new, not-yet-confirmed items across syncs. `seenEventIds` tracks
// every event already processed (mapped OR skipped) so nothing is re-evaluated.
export interface CollectorJson {
  drafts: ParsedTransaction[];
  errors: ImportIssue[];
  // `seenEventIds` (legacy) is no longer written — "already handled" now lives durably in
  // tr_resolved_events; staged-not-resolved items are derived from the draft's own contents.
  seenEventIds?: string[];
}

// Reads the app's OWN round-tripped JSONB column, so corruption is unlikely — but a malformed
// row (failed write, a future shape change, a manual DB edit) shouldn't throw mid-sync.
// Validate the shape just enough to use it safely and fall back otherwise, so the next sync
// self-heals: a dropped collector simply re-stages unresolved events from the durable ledger.
export function asCollectorJson(v: unknown, log?: FastifyBaseLogger): CollectorJson | null {
  const o = v as Record<string, unknown> | null;
  if (o && Array.isArray(o.drafts) && Array.isArray(o.errors)) return o as unknown as CollectorJson;
  if (v != null)
    log?.warn({ parsedJson: v }, "tr collector json malformed — ignoring (will re-stage)");
  return null;
}

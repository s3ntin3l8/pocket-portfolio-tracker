"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { useInterval } from "@/lib/use-interval";
import type { PortfolioSyncConfig } from "@/components/portfolio-card-menu";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 300_000; // 5 min — same ceiling as runner exportTimeoutMs

/**
 * Headless — no rendered output. Polls a portfolio's TR/IBKR sync status and calls
 * `router.refresh()` once it finishes, so the list's `SYNCING…`/`CONNECTED` status badge
 * (computed server-side in `settings/portfolios/page.tsx`) picks up the new state without
 * a manual reload.
 *
 * Extracted from `PortfolioCardMenu`'s poll effects (unchanged logic) so the list can keep
 * auto-updating a syncing portfolio's badge now that the card's `⋯` menu — and its "Sync
 * now" trigger — moved into the portfolio edit page (`portfolio-edit-form.tsx`'s connection
 * sections already run their own polling while that page is open; this component covers
 * the *list* view, where no menu/edit-page poller is mounted). No local "syncing" state of
 * its own — it doesn't render anything, so it only needs to know when to stop polling.
 */
export function PortfolioSyncWatcher({
  trSync,
  ibkrSync,
}: {
  trSync?: PortfolioSyncConfig;
  ibkrSync?: PortfolioSyncConfig;
}) {
  const ttr = useTranslations("TradeRepublic");
  const tibkr = useTranslations("InteractiveBrokers");
  const api = useApiClient();
  const router = useRouter();

  // Each poller runs only while its sync is in flight and the tab is visible
  // (`useInterval` pauses on `document.hidden`). Visible ticks, not wall-clock, count
  // toward the 5 min ceiling — a backgrounded tab never burns the budget.
  const [trPolling, setTrPolling] = useState(Boolean(trSync?.initialSyncing));
  const [ibkrPolling, setIbkrPolling] = useState(Boolean(ibkrSync?.initialSyncing));
  const trTicks = useRef(0);
  const ibkrTicks = useRef(0);

  // A later `router.refresh()` can flip `initialSyncing` false -> true without remounting
  // us (an in-place sync start); the useState initializers above only see mount-time
  // props. Adjust state during render on the flip (React's "derive from props" pattern)
  // instead of ignoring it.
  const trSyncing = Boolean(trSync?.initialSyncing);
  const ibkrSyncing = Boolean(ibkrSync?.initialSyncing);
  const [seenTrSyncing, setSeenTrSyncing] = useState(trSyncing);
  const [seenIbkrSyncing, setSeenIbkrSyncing] = useState(ibkrSyncing);
  if (seenTrSyncing !== trSyncing) {
    setSeenTrSyncing(trSyncing);
    if (trSyncing) setTrPolling(true);
  }
  if (seenIbkrSyncing !== ibkrSyncing) {
    setSeenIbkrSyncing(ibkrSyncing);
    if (ibkrSyncing) setIbkrPolling(true);
  }

  useInterval(
    async () => {
      trTicks.current += 1;
      if (trTicks.current * POLL_INTERVAL_MS > POLL_TIMEOUT_MS) {
        setTrPolling(false);
        toast.error(ttr("errors.tr_sync_failed"));
        return;
      }
      try {
        const conn = await api.getTrConnection();
        if (!conn.syncing) {
          setTrPolling(false);
          // `lastError` is server-side/English diagnostic text — show our translated copy.
          if (conn.lastError) toast.error(ttr("errors.tr_sync_failed"));
          else router.refresh();
        }
      } catch {
        // transient — keep polling
      }
    },
    trPolling ? POLL_INTERVAL_MS : null,
  );

  useInterval(
    async () => {
      ibkrTicks.current += 1;
      if (ibkrTicks.current * POLL_INTERVAL_MS > POLL_TIMEOUT_MS) {
        setIbkrPolling(false);
        toast.error(tibkr("errors.ibkr_sync_failed"));
        return;
      }
      try {
        const conn = await api.getIbkrConnection();
        if (!conn.syncing) {
          setIbkrPolling(false);
          if (conn.lastError) toast.error(tibkr("errors.ibkr_sync_failed"));
          else router.refresh();
        }
      } catch {
        // transient — keep polling
      }
    },
    ibkrPolling ? POLL_INTERVAL_MS : null,
  );

  return null;
}

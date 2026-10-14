"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useApiClient } from "@/lib/api";
import { apiErrorCode } from "@portfolio/api-client";
import type { TxRow } from "./types";
import { groupIdsByPortfolio, runBulkByPortfolio, type SelectionEntry } from "./bulk";

/**
 * Bulk/single mutations behind the Activity selection bar and detail sheet: batch delete,
 * batch/one draft resolve, and reassign-to-portfolio. Owns the in-flight flags and the
 * reassign/confirm dialog state; the selection itself stays with the table.
 */
export function useBatchActions({
  selectedEntries,
  clearSelection,
}: {
  selectedEntries: SelectionEntry[];
  clearSelection: () => void;
}) {
  const tTx = useTranslations("Transactions");
  const tr = useTranslations("Transactions.reassign");
  const api = useApiClient();
  const router = useRouter();

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [reassignRows, setReassignRows] = useState<SelectionEntry[] | null>(null);

  async function onBatchDelete() {
    setBusy(true);
    try {
      await runBulkByPortfolio(groupIdsByPortfolio(selectedEntries), (portfolioId, ids) =>
        api.bulkDeleteTransactions(portfolioId, ids),
      );
      clearSelection();
      router.refresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  async function onBatchResolve(action: "confirm" | "discard") {
    setBusy(true);
    try {
      await runBulkByPortfolio(
        groupIdsByPortfolio(selectedEntries.filter((e) => e.status === "draft")),
        (portfolioId, ids) => api.resolveDraftTransactions(portfolioId, ids, action),
      );
      clearSelection();
      router.refresh();
    } catch (err) {
      if (!handleResolveError(err)) throw err;
      router.refresh(); // other portfolios' batches may have gone through
    } finally {
      setBusy(false);
    }
  }

  // Confirm refuses an inbound depot transfer that still has no cost basis (price 0) —
  // audit B4. Surface it as a translated toast instead of an unhandled rejection; the
  // user fixes it by editing the draft's price. Returns false for any other error.
  function handleResolveError(err: unknown): boolean {
    if (apiErrorCode(err) !== "transfer_cost_basis_required") return false;
    toast.error(tTx("draftTransferCostBasisRequired"));
    return true;
  }

  async function onResolveOne(tx: TxRow, action: "confirm" | "discard") {
    setResolvingId(tx.id);
    try {
      await api.resolveDraftTransactions(tx.portfolioId, [tx.id], action);
      router.refresh();
    } catch (err) {
      if (!handleResolveError(err)) throw err;
    } finally {
      setResolvingId(null);
    }
  }

  async function doReassign(targetPortfolioId: string) {
    const queued = (reassignRows ?? []).filter((r) => r.portfolioId !== targetPortfolioId);
    let moved = 0;
    let skipped = 0;
    const results = await runBulkByPortfolio(groupIdsByPortfolio(queued), (pid, ids) =>
      api.reassignTransactions(pid, ids, targetPortfolioId),
    );
    for (const r of results) {
      moved += r.moved;
      skipped += r.skippedConflicts + r.skippedLoans;
    }
    if (moved === 0) toast.info(tr("none"));
    else if (skipped > 0) toast.success(tr("successWithSkips", { moved, skipped }));
    else toast.success(tr("success", { count: moved }));
    setReassignRows(null);
    clearSelection();
    router.refresh();
  }

  return {
    busy,
    confirming,
    setConfirming,
    resolvingId,
    reassignRows,
    setReassignRows,
    onBatchDelete,
    onBatchResolve,
    onResolveOne,
    doReassign,
  };
}

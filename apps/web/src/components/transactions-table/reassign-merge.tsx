"use client";

import { ReassignDialog } from "@/components/reassign-dialog";
import { MergeDialog } from "@/components/merge-dialog";
import type { PickablePortfolio } from "@/components/portfolio-picker";
import type { TxRow } from "./types";

export function ReassignMergeDialogs({
  reassignRows,
  onCloseReassign,
  portfolios,
  onConfirmReassign,
  mergeRows,
  onCloseMerge,
  onMerged,
}: {
  reassignRows: TxRow[] | null;
  onCloseReassign: () => void;
  portfolios: PickablePortfolio[];
  onConfirmReassign: (targetPortfolioId: string) => Promise<void>;
  mergeRows: [TxRow, TxRow] | null;
  onCloseMerge: () => void;
  onMerged: () => void;
}) {
  return (
    <>
      {reassignRows && (
        <ReassignDialog
          open
          onOpenChange={(o) => {
            if (!o) onCloseReassign();
          }}
          portfolios={portfolios}
          excludePortfolioId={
            new Set(reassignRows.map((r) => r.portfolioId)).size === 1
              ? reassignRows[0]?.portfolioId
              : undefined
          }
          onConfirm={onConfirmReassign}
        />
      )}

      {mergeRows && (
        <MergeDialog
          open
          onOpenChange={(o) => {
            if (!o) onCloseMerge();
          }}
          rowA={mergeRows[0]}
          rowB={mergeRows[1]}
          onMerged={onMerged}
        />
      )}
    </>
  );
}

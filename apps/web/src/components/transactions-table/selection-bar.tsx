"use client";

import { useTranslations } from "next-intl";
import { X, Check, FolderInput, GitMerge, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

export function SelectionBar({
  selectionMode,
  selectedCount,
  selectedDraftCount,
  canReassign,
  canMerge,
  busy,
  confirming,
  onClearSelection,
  onBatchConfirmDrafts,
  onBatchDiscardDrafts,
  onReassign,
  onMerge,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  selectionMode: boolean;
  selectedCount: number;
  selectedDraftCount: number;
  canReassign: boolean;
  canMerge: boolean;
  busy: boolean;
  confirming: boolean;
  onClearSelection: () => void;
  onBatchConfirmDrafts: () => void;
  onBatchDiscardDrafts: () => void;
  onReassign: () => void;
  onMerge: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const tb = useTranslations("Transactions.batch");

  if (!selectionMode) return null;

  return (
    <div className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-4 py-2 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <button
          type="button"
          onClick={onClearSelection}
          aria-label={tb("cancel")}
          title={tb("cancel")}
          className="flex size-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        {selectedCount > 0 ? tb("selected", { count: selectedCount }) : tb("selectPrompt")}
      </span>
      {selectedCount > 0 &&
        (confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">{tb("confirmPrompt")}</span>
            <Button size="sm" variant="destructive" onClick={onConfirmDelete} disabled={busy}>
              {busy && <Spinner size="xs" />}
              {tb("confirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelDelete} disabled={busy}>
              {tb("cancel")}
            </Button>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            {selectedDraftCount > 0 && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onBatchConfirmDrafts}
                  disabled={busy}
                >
                  {busy && <Spinner size="xs" />}
                  <Check className="size-3.5" />
                  {tb("confirmDrafts")}
                </Button>
                <Button size="sm" variant="outline" onClick={onBatchDiscardDrafts} disabled={busy}>
                  {tb("discardDrafts")}
                </Button>
              </>
            )}
            {canReassign && (
              <Button size="sm" variant="outline" onClick={onReassign} disabled={busy}>
                <FolderInput className="size-3.5" />
                {tb("reassign")}
              </Button>
            )}
            {canMerge && (
              <Button size="sm" variant="outline" onClick={onMerge} disabled={busy}>
                <GitMerge className="size-3.5" />
                {tb("merge")}
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={onRequestDelete} disabled={busy}>
              <Trash2 className="size-3.5" />
              {tb("delete")}
            </Button>
          </span>
        ))}
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { X, Check, FolderInput, GitMerge, Trash2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/lib/use-media-query";

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
  const isMobile = !useMediaQuery("(min-width: 768px)");

  if (!selectionMode) return null;

  const actions =
    selectedCount > 0 ? (
      confirming ? (
        <span className="flex items-center gap-2">
          <span className="hidden text-muted-foreground sm:inline">{tb("confirmPrompt")}</span>
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
              <Button size="sm" variant="secondary" onClick={onBatchConfirmDrafts} disabled={busy}>
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
      )
    ) : null;

  if (isMobile) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-4 py-3 shadow-lg backdrop-blur-sm safe-area-bottom">
        <div className="flex items-center justify-between gap-2">
          <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
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
          {actions && (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {actions}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-4 py-2 text-sm">
      <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
        <button
          type="button"
          onClick={onClearSelection}
          aria-label={tb("cancel")}
          title={tb("cancel")}
          className="flex size-8 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
        {selectedCount > 0 ? tb("selected", { count: selectedCount }) : tb("selectPrompt")}
      </span>
      {actions}
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SelectionBarShell } from "@/components/ui/selection-bar-shell";

export interface SelectionBarProps {
  selectionMode: boolean;
  selected: Set<string>;
  confirmingBulk: boolean;
  bulkBusy: boolean;
  selectedConfirmedTx: number;
  onBulkDelete: () => void;
  onSetConfirmingBulk: (v: boolean) => void;
  onExitSelection: () => void;
  /** Layout margin for the desktop inline placement — the mobile fixed-bottom state
   *  ignores this (it's edge-to-edge by design). Callers previously baked `mx-6 mb-3`
   *  into this component unconditionally; that only ever made sense for the inline
   *  desktop state, so it moved here as an explicit, opt-in prop. */
  className?: string;
}

export function SelectionBar({
  selectionMode,
  selected,
  confirmingBulk,
  bulkBusy,
  selectedConfirmedTx,
  onBulkDelete,
  onSetConfirmingBulk,
  onExitSelection,
  className,
}: SelectionBarProps) {
  const t = useTranslations("ImportHistory");
  if (!selectionMode) return null;

  const actions = confirmingBulk ? (
    <span className="flex items-center gap-2">
      {/* Hidden below sm: this bar now also renders as a narrow fixed-bottom bar on
          mobile (SelectionBarShell) — this prompt + two buttons doesn't fit there,
          same truncation the sibling transactions-table bar already applies. */}
      <span className="hidden text-muted-foreground sm:inline">
        {t("bulkConfirmPrompt", { count: selectedConfirmedTx })}
      </span>
      <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={onBulkDelete}>
        {bulkBusy && <Spinner size="xs" />}
        {t("deleteSelected")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={bulkBusy}
        onClick={() => onSetConfirmingBulk(false)}
      >
        {t("cancel")}
      </Button>
    </span>
  ) : selected.size > 0 ? (
    <Button size="sm" variant="destructive" disabled={bulkBusy} onClick={onBulkDelete}>
      {bulkBusy ? <Spinner size="xs" /> : <Trash2 className="size-3.5" />}
      {t("deleteSelected")}
    </Button>
  ) : null;

  return (
    <SelectionBarShell
      label={selected.size > 0 ? t("selectedCount", { count: selected.size }) : t("selectPrompt")}
      onDismiss={onExitSelection}
      dismissLabel={t("cancelSelection")}
      className={className}
    >
      {actions}
    </SelectionBarShell>
  );
}

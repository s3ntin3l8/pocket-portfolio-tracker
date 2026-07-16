"use client";

import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export interface BulkToolbarProps {
  selectedCount: number;
  busy: boolean;
  pending: string | null;
  onConfirmSelected: () => void;
  confirming: boolean;
  onRequestConfirm: () => void;
  onCancelConfirm: () => void;
  onRemoveConfirm: () => void;
}

export function BulkToolbar({
  selectedCount,
  busy,
  pending,
  onConfirmSelected,
  confirming,
  onRequestConfirm,
  onCancelConfirm,
  onRemoveConfirm,
}: BulkToolbarProps) {
  const t = useTranslations("Import");
  if (selectedCount === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/60 px-4 py-2 text-sm">
      <span className="text-muted-foreground">
        {t("review.batch.selected", { count: selectedCount })}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={onConfirmSelected}>
          {pending === "confirmSelected" && <Spinner size="xs" />}
          {t("review.batch.confirmSelected")}
        </Button>
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("review.batch.removePrompt")}</span>
            <Button size="sm" variant="destructive" onClick={onRemoveConfirm}>
              {t("review.batch.removeConfirm")}
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancelConfirm}>
              {t("review.batch.cancel")}
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="destructive" onClick={onRequestConfirm}>
            <Trash2 className="size-3.5" />
            {t("review.batch.remove")}
          </Button>
        )}
      </div>
    </div>
  );
}

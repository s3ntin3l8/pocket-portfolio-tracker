"use client";

import { useTranslations } from "next-intl";
import { Pencil, Trash2 } from "lucide-react";
import { LOW_CONFIDENCE_THRESHOLD } from "@portfolio/api-client";
import { TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReviewDraft } from "./types";
import { fmtQty, fmtAmt } from "./types";

export function DraftRow({
  draft,
  isSelected,
  onToggle,
  onEdit,
  onRemove,
  showRemove,
}: {
  draft: ReviewDraft;
  isSelected: boolean;
  onToggle: (uid: string) => void;
  onEdit: (uid: string) => void;
  onRemove: (uid: string) => void;
  showRemove: boolean;
}) {
  const t = useTranslations("Import");
  const pct = (c: number) => t("confidence", { pct: Math.round(c * 100) });
  const dateOf = (d: ReviewDraft) => d.executedAt.slice(0, 10);
  const dupLabel = (d: ReviewDraft) => {
    if (d.likelyDuplicate?.kind === "enrichment") {
      return t("review.enrichment", {
        source: d.likelyDuplicate.source ?? "—",
        date: (d.likelyDuplicate.executedAt ?? "").slice(0, 10),
      });
    }
    return t("review.duplicate", {
      source: d.likelyDuplicate?.source ?? "—",
      date: (d.likelyDuplicate?.executedAt ?? "").slice(0, 10),
    });
  };
  return (
    <>
      <TableCell>
        <input
          type="checkbox"
          className="size-4 align-middle accent-primary"
          aria-label={t("review.selectRow")}
          checked={isSelected}
          onChange={() => onToggle(draft.uid)}
        />
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-1">
          <Badge variant={draft.confidence >= LOW_CONFIDENCE_THRESHOLD ? "success" : "warning"}>
            {pct(draft.confidence)}
          </Badge>
          {draft.likelyDuplicate && (
            <Badge
              variant={draft.likelyDuplicate.kind === "enrichment" ? "default" : "warning"}
              title={dupLabel(draft)}
            >
              {dupLabel(draft)}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{draft.assetClass}</Badge>
      </TableCell>
      <TableCell>
        <Badge
          variant={
            draft.action === "sell" || draft.action === "withdrawal" ? "destructive" : "success"
          }
        >
          {draft.action}
        </Badge>
      </TableCell>
      <TableCell className="font-medium">{draft.name ?? "—"}</TableCell>
      <TableCell className="tabular text-xs text-muted-foreground">{draft.isin ?? "—"}</TableCell>
      <TableCell className="tabular text-xs text-muted-foreground">{draft.wkn ?? "—"}</TableCell>
      <TableCell className="tabular whitespace-nowrap text-muted-foreground">
        {dateOf(draft)}
      </TableCell>
      <TableCell className="tabular text-right">{fmtQty(draft.quantity)}</TableCell>
      <TableCell className="tabular text-right">{fmtAmt(draft.price)}</TableCell>
      <TableCell className="tabular text-right text-muted-foreground">
        {draft.total ? fmtAmt(draft.total) : "—"}
      </TableCell>
      <TableCell className="tabular text-right text-muted-foreground">
        {draft.fees ? fmtAmt(draft.fees) : "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{draft.currency}</TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("review.edit.open")}
            onClick={() => onEdit(draft.uid)}
          >
            <Pencil className="size-4" />
          </Button>
          {showRemove && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("remove")}
              onClick={() => onRemove(draft.uid)}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </TableCell>
    </>
  );
}

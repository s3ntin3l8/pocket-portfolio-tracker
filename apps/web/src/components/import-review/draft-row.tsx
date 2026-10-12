"use client";

import { useTranslations } from "next-intl";
import { Pencil, Trash2 } from "lucide-react";
import { LOW_CONFIDENCE_THRESHOLD } from "@portfolio/api-client";
import { TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { draftNeedsCostBasis } from "@/components/import-flow/types";
import type { ImportDraft, ReviewDraft } from "./types";
import { fmtQty, fmtAmt } from "./types";

export function DraftRow({
  draft,
  isSelected,
  onToggle,
  onEdit,
  onRemove,
  onUpdate,
  showRemove,
}: {
  draft: ReviewDraft;
  isSelected: boolean;
  onToggle: (uid: string) => void;
  onEdit: (uid: string) => void;
  onRemove: (uid: string) => void;
  /** Inline edits (the carried cost basis of an inbound transfer). Read-only when omitted. */
  onUpdate?: (uid: string, patch: Partial<ImportDraft>) => void;
  showRemove: boolean;
}) {
  // An inbound transfer the parser couldn't price (or one the user hasn't priced yet) —
  // its cost basis is required before confirm, so the price is editable right on the row.
  const needsCostBasis =
    draftNeedsCostBasis(draft) || (draft.attention ?? []).includes("needs_cost_basis");
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
          {draftNeedsCostBasis(draft) && (
            <Badge variant="warning" title={t("review.needsCostBasisHint")}>
              {t("review.needsCostBasis")}
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
      <TableCell className="tabular text-right">
        {needsCostBasis && onUpdate ? (
          <Input
            inputMode="decimal"
            className="ml-auto h-8 w-28 text-right"
            aria-label={t("review.costBasisLabel")}
            placeholder={t("review.costBasisPlaceholder")}
            value={draft.price === "0" ? "" : draft.price}
            onChange={(e) => onUpdate(draft.uid, { price: e.target.value.trim() || "0" })}
          />
        ) : (
          fmtAmt(draft.price)
        )}
      </TableCell>
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

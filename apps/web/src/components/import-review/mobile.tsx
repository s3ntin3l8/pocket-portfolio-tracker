"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Trash2 } from "lucide-react";
import { LOW_CONFIDENCE_THRESHOLD } from "@portfolio/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PortfolioPicker } from "@/components/portfolio-picker";
import { cn } from "@/lib/utils";
import type { ReviewDraft } from "./types";
import type { ImportReviewGroup, ImportTargetPortfolio } from "./types";
import { fmtQty, fmtAmt } from "./types";

function MobileDraftCard({
  draft,
  selected,
  onToggle,
  onEdit,
  onRemove,
  showRemove,
}: {
  draft: ReviewDraft;
  selected: boolean;
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
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 align-middle accent-primary"
          aria-label={t("review.selectRow")}
          checked={selected}
          onChange={() => onToggle(draft.uid)}
        />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onEdit(draft.uid)}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{draft.name ?? "—"}</span>
            <Badge variant={draft.confidence >= LOW_CONFIDENCE_THRESHOLD ? "success" : "warning"}>
              {pct(draft.confidence)}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant="outline">{draft.assetClass}</Badge>
            <Badge
              variant={
                draft.action === "sell" || draft.action === "withdrawal" ? "destructive" : "success"
              }
            >
              {draft.action}
            </Badge>
            <span className="text-muted-foreground">{dateOf(draft)}</span>
            {draft.isin && <span className="font-mono text-muted-foreground">{draft.isin}</span>}
            {draft.wkn && <span className="font-mono text-muted-foreground">{draft.wkn}</span>}
            {draft.likelyDuplicate && (
              <Badge variant={draft.likelyDuplicate.kind === "enrichment" ? "default" : "warning"}>
                {dupLabel(draft)}
              </Badge>
            )}
          </div>
          <div className="mt-1 tabular text-sm text-muted-foreground">
            {fmtQty(draft.quantity)} × {fmtAmt(draft.price)} {draft.currency}
            {draft.total && <span className="ml-2">= {fmtAmt(draft.total)}</span>}
            {draft.fees && draft.fees !== "0" && (
              <span className="ml-1">(+{fmtAmt(draft.fees)} fees)</span>
            )}
          </div>
        </button>
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
    </div>
  );
}

export interface MobileViewProps {
  view: ReviewDraft[];
  draftsLength: number;
  isGrouped: boolean;
  groups?: ImportReviewGroup[];
  collapsed: Set<string>;
  onToggleCollapse: (importId: string) => void;
  portfolios?: ImportTargetPortfolio[];
  portfolioByImport?: Map<string, string>;
  onPortfolioChange?: (importId: string, portfolioId: string) => void;
  selected: Set<string>;
  onToggle: (uid: string) => void;
  onEdit: (uid: string) => void;
  onRemove: (uid: string) => void;
}

export function MobileView({
  view,
  draftsLength,
  isGrouped,
  groups,
  collapsed,
  onToggleCollapse,
  portfolios,
  portfolioByImport,
  onPortfolioChange,
  selected,
  onToggle,
  onEdit,
  onRemove,
}: MobileViewProps) {
  const t = useTranslations("Import");
  return (
    <div className="space-y-2 md:hidden">
      {isGrouped
        ? groups!.map((g) => {
            const isCollapsed = collapsed.has(g.importId);
            const groupView = view.filter((d) => d.importId === g.importId);
            return (
              <React.Fragment key={g.importId}>
                <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
                  <button
                    type="button"
                    aria-label={isCollapsed ? t("group.expand") : t("group.collapse")}
                    onClick={() => onToggleCollapse(g.importId)}
                    className="flex flex-1 items-center gap-1.5 text-sm font-medium"
                  >
                    <ChevronDown
                      className={cn(
                        "size-4 shrink-0 transition-transform",
                        isCollapsed && "-rotate-90",
                      )}
                    />
                    <span className="truncate">{g.filename}</span>
                    <span className="ml-1 text-xs text-muted-foreground">({groupView.length})</span>
                  </button>
                  {portfolios && portfolios.length > 1 && onPortfolioChange && (
                    <PortfolioPicker
                      ariaLabel={t("group.portfolio")}
                      portfolios={portfolios}
                      value={portfolioByImport?.get(g.importId) ?? portfolios[0]?.id ?? ""}
                      onChange={(id) => onPortfolioChange(g.importId, id)}
                      triggerClassName="h-7 w-auto text-xs"
                    />
                  )}
                </div>
                {!isCollapsed &&
                  groupView.map((d) => (
                    <MobileDraftCard
                      key={d.uid}
                      draft={d}
                      selected={selected.has(d.uid)}
                      onToggle={onToggle}
                      onEdit={onEdit}
                      onRemove={onRemove}
                      showRemove={draftsLength > 1}
                    />
                  ))}
              </React.Fragment>
            );
          })
        : view.map((d) => (
            <MobileDraftCard
              key={d.uid}
              draft={d}
              selected={selected.has(d.uid)}
              onToggle={onToggle}
              onEdit={onEdit}
              onRemove={onRemove}
              showRemove={draftsLength > 1}
            />
          ))}
      {view.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">{t("review.empty")}</p>
      )}
    </div>
  );
}

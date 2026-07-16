"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Pencil, Trash2 } from "lucide-react";
import { LOW_CONFIDENCE_THRESHOLD } from "@portfolio/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PortfolioPicker } from "@/components/portfolio-picker";
import { cn } from "@/lib/utils";
import type { SortDir } from "@/lib/table-sort";
import type { ReviewDraft, ImportIssue } from "./types";
import type { ImportReviewGroup, ImportTargetPortfolio } from "./types";
import { TABLE_COL_COUNT, fmtQty, fmtAmt } from "./types";

function DraftRow({
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

function IssueRow({ issue, onMap }: { issue: ImportIssue; onMap?: (issue: ImportIssue) => void }) {
  const t = useTranslations("Import");
  const pct = (c: number) => t("confidence", { pct: Math.round(c * 100) });
  return (
    <>
      <TableCell>
        <input
          type="checkbox"
          className="size-4 align-middle opacity-40"
          disabled
          readOnly
          aria-label={t("review.selectRow")}
          checked={false}
        />
      </TableCell>
      <TableCell>
        <Badge variant="warning">{pct(0)}</Badge>
      </TableCell>
      <TableCell>
        <Badge variant="outline">—</Badge>
      </TableCell>
      <TableCell>
        <Badge variant="outline">—</Badge>
      </TableCell>
      <TableCell className="font-medium">{issue.raw?.name ?? issue.eventType ?? "—"}</TableCell>
      <TableCell className="tabular text-xs text-muted-foreground">
        {issue.raw?.isin ?? "—"}
      </TableCell>
      <TableCell className="tabular text-xs text-muted-foreground">
        {issue.raw?.wkn ?? "—"}
      </TableCell>
      <TableCell className="tabular whitespace-nowrap text-muted-foreground">
        {issue.raw?.executedAt?.slice(0, 10) ?? "—"}
      </TableCell>
      <TableCell className="tabular text-right text-muted-foreground">
        {issue.raw?.shares != null ? fmtQty(String(issue.raw.shares)) : "—"}
      </TableCell>
      <TableCell className="tabular text-right text-muted-foreground">
        {issue.raw?.amount != null ? fmtAmt(String(Math.abs(issue.raw.amount))) : "—"}
      </TableCell>
      <TableCell />
      <TableCell />
      <TableCell className="text-xs text-muted-foreground">{issue.raw?.currency ?? "—"}</TableCell>
      <TableCell className="text-right">
        {onMap && (
          <Button size="sm" variant="secondary" onClick={() => onMap(issue)}>
            {t("review.issues.map")}
          </Button>
        )}
      </TableCell>
    </>
  );
}

export interface ImportTableProps {
  drafts: ReviewDraft[];
  view: ReviewDraft[];
  visibleIssueRows: ImportIssue[];
  isGrouped: boolean;
  groups?: ImportReviewGroup[];
  collapsed: Set<string>;
  onToggleCollapse: (importId: string) => void;
  portfolios?: ImportTargetPortfolio[];
  portfolioByImport?: Map<string, string>;
  onPortfolioChange?: (importId: string, portfolioId: string) => void;
  issuesByImport?: Map<string, ImportIssue[]>;
  selected: Set<string>;
  onToggle: (uid: string) => void;
  allVisibleSelected: boolean;
  onToggleAll: () => void;
  sortKey: string | null;
  sortDir: SortDir;
  onToggleSort: (key: string) => void;
  onEdit: (uid: string) => void;
  onRemove: (uid: string) => void;
  onMapIssue?: (issue: ImportIssue) => void;
  assetClassFilter: Set<string>;
  actionFilter: Set<string>;
  query: string;
}

export function ImportTable({
  drafts,
  view,
  visibleIssueRows,
  isGrouped,
  groups,
  collapsed,
  onToggleCollapse,
  portfolios,
  portfolioByImport,
  onPortfolioChange,
  issuesByImport,
  selected,
  onToggle,
  allVisibleSelected,
  onToggleAll,
  sortKey,
  sortDir,
  onToggleSort,
  onEdit,
  onRemove,
  onMapIssue,
  assetClassFilter,
  actionFilter,
  query,
}: ImportTableProps) {
  const t = useTranslations("Import");
  const tm = useTranslations("Manage");

  return (
    <div className="hidden rounded-xl bg-card shadow-card md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <input
                type="checkbox"
                className="size-4 align-middle accent-primary"
                aria-label={t("review.selectAll")}
                checked={allVisibleSelected}
                onChange={onToggleAll}
              />
            </TableHead>
            <SortableTableHead
              colKey="confidence"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
            >
              {t("review.columns.confidence")}
            </SortableTableHead>
            <SortableTableHead
              colKey="assetClass"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
            >
              {t("review.columns.assetClass")}
            </SortableTableHead>
            <SortableTableHead
              colKey="action"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
            >
              {t("review.columns.action")}
            </SortableTableHead>
            <SortableTableHead
              colKey="name"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
            >
              {t("fields.name")}
            </SortableTableHead>
            <SortableTableHead
              colKey="isin"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
            >
              {t("fields.isin")}
            </SortableTableHead>
            <SortableTableHead
              colKey="wkn"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
            >
              {t("fields.wkn")}
            </SortableTableHead>
            <SortableTableHead
              colKey="executedAt"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
            >
              {t("fields.executedAt")}
            </SortableTableHead>
            <SortableTableHead
              colKey="quantity"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
              className="text-right"
            >
              {t("fields.quantity")}
            </SortableTableHead>
            <SortableTableHead
              colKey="price"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
              className="text-right"
            >
              {t("fields.price")}
            </SortableTableHead>
            <SortableTableHead
              colKey="total"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
              className="text-right"
            >
              {t("fields.total")}
            </SortableTableHead>
            <SortableTableHead
              colKey="fees"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
              className="text-right"
            >
              {t("fields.fees")}
            </SortableTableHead>
            <TableHead>{t("fields.currency")}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">{tm("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isGrouped
            ? groups!.map((g) => {
                const isCollapsed = collapsed.has(g.importId);
                const groupView = view.filter((d) => d.importId === g.importId);
                const groupAttn = (issuesByImport?.get(g.importId) ?? []).filter(
                  (i) => i.severity === "attention" && i.eventId,
                );
                const q = query.trim().toLowerCase();
                const groupIssueRows =
                  assetClassFilter.size > 0 || actionFilter.size > 0
                    ? []
                    : groupAttn.filter(
                        (i) => !q || (i.raw?.name ?? i.eventType ?? "").toLowerCase().includes(q),
                      );
                return (
                  <React.Fragment key={g.importId}>
                    <TableRow className="bg-muted/30 hover:bg-muted/40">
                      <TableCell colSpan={TABLE_COL_COUNT} className="py-2">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            aria-label={isCollapsed ? t("group.expand") : t("group.collapse")}
                            onClick={() => onToggleCollapse(g.importId)}
                            className="flex items-center gap-1.5 text-sm font-medium text-foreground"
                          >
                            <ChevronDown
                              className={cn(
                                "size-4 shrink-0 transition-transform",
                                isCollapsed && "-rotate-90",
                              )}
                            />
                            {g.filename}
                          </button>
                          <span className="text-xs text-muted-foreground">
                            ({groupView.length + groupIssueRows.length})
                          </span>
                          {portfolios && portfolios.length > 1 && onPortfolioChange && (
                            <PortfolioPicker
                              ariaLabel={t("group.portfolio")}
                              portfolios={portfolios}
                              value={portfolioByImport?.get(g.importId) ?? portfolios[0]?.id ?? ""}
                              onChange={(id) => onPortfolioChange(g.importId, id)}
                              triggerClassName="ml-auto h-7 w-auto text-xs"
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {!isCollapsed &&
                      groupView.map((d) => (
                        <TableRow
                          key={d.uid}
                          data-state={selected.has(d.uid) ? "selected" : undefined}
                        >
                          <DraftRow
                            draft={d}
                            isSelected={selected.has(d.uid)}
                            onToggle={onToggle}
                            onEdit={onEdit}
                            onRemove={onRemove}
                            showRemove={drafts.length > 1}
                          />
                        </TableRow>
                      ))}
                    {!isCollapsed &&
                      groupIssueRows.map((issue) => (
                        <TableRow key={issue.eventId ?? issue.eventType} className="opacity-80">
                          <IssueRow issue={issue} onMap={onMapIssue} />
                        </TableRow>
                      ))}
                  </React.Fragment>
                );
              })
            : view.map((d) => (
                <TableRow key={d.uid} data-state={selected.has(d.uid) ? "selected" : undefined}>
                  <DraftRow
                    draft={d}
                    isSelected={selected.has(d.uid)}
                    onToggle={onToggle}
                    onEdit={onEdit}
                    onRemove={onRemove}
                    showRemove={drafts.length > 1}
                  />
                </TableRow>
              ))}
          {!isGrouped &&
            visibleIssueRows.map((issue) => (
              <TableRow key={issue.eventId ?? issue.eventType} className="opacity-80">
                <IssueRow issue={issue} onMap={onMapIssue} />
              </TableRow>
            ))}
          {view.length === 0 && visibleIssueRows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={TABLE_COL_COUNT}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                {t("review.empty")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

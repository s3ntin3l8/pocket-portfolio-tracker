"use client";

import { Fragment } from "react";
import { useTranslations, useLocale } from "next-intl";
import { AlertCircle, AlertTriangle, ChevronRight, ListChecks } from "lucide-react";
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
import { ScopeLink } from "@/components/scope-link";
import { formatMoney, anomalyLabel, type AnomalyTranslator } from "@/lib/utils";
import { TxRow, KIND_ICON } from "./types";
import {
  SourceChips,
  TypeIconChip,
  txNetAmount,
  rowQuantityDisplay,
  rowPerShareDisplay,
} from "./utils";
import type { Anomaly } from "@portfolio/api-client";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoTip } from "@/components/ui/tooltip";

export function DesktopTable({
  rows,
  selectionMode,
  selected,
  anomalyByTxId,
  sortKey,
  sortDir,
  onToggleSort,
  showPortfolio,
  groupByMonth,
  colSpan,
  monthFmt,
  longPressHandlers,
  onRowActivate,
  onToggle,
  onToggleAll,
  selectState,
  onEnterSelectionMode,
  hasActiveFilter,
  showEmpty,
}: {
  rows: TxRow[];
  selectionMode: boolean;
  selected: Set<string>;
  anomalyByTxId: Map<string, Anomaly>;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  onToggleSort: (key: string) => void;
  showPortfolio: boolean;
  groupByMonth: boolean;
  colSpan: number;
  monthFmt: Intl.DateTimeFormat;
  longPressHandlers: (id: string) => {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerMove: (e: React.PointerEvent) => void;
  };
  onRowActivate: (tx: TxRow) => void;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  /** Header checkbox state: `"indeterminate"` when only some visible rows are selected. */
  selectState: boolean | "indeterminate";
  onEnterSelectionMode: () => void;
  hasActiveFilter: boolean;
  showEmpty: boolean;
}) {
  const t = useTranslations("Transactions");
  const tb = useTranslations("Transactions.batch");
  const tt = useTranslations("TxType");
  const tm = useTranslations("Manage");
  const ta = useTranslations("Anomalies");
  const locale = useLocale();
  const m = (n: number, currency: string) => formatMoney(n, currency, locale);
  const rowDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.getUTCDate()} ${new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(d)}`;
  };

  return (
    <div className="scroll-shadow-x hidden rounded-lg bg-card shadow-card lg:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">
              {selectionMode ? (
                <Checkbox
                  className="size-4"
                  aria-label={tb("selectAll")}
                  checked={selectState}
                  onCheckedChange={() => onToggleAll()}
                />
              ) : (
                <InfoTip label={tb("selectRows")}>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-6"
                    aria-label={tb("selectRows")}
                    onClick={onEnterSelectionMode}
                  >
                    <ListChecks className="size-4" />
                  </Button>
                </InfoTip>
              )}
            </TableHead>
            <SortableTableHead
              colKey="date"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
            >
              {t("date")}
            </SortableTableHead>
            <SortableTableHead
              colKey="instrument"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
            >
              {t("transactionCol")}
            </SortableTableHead>
            {showPortfolio && (
              <SortableTableHead
                colKey="portfolio"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={onToggleSort}
              >
                {t("portfolio")}
              </SortableTableHead>
            )}
            <SortableTableHead
              colKey="quantity"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
              align="right"
            >
              {t("quantity")}
            </SortableTableHead>
            <SortableTableHead
              colKey="price"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
              align="right"
            >
              {t("price")}
            </SortableTableHead>
            <SortableTableHead
              colKey="tax"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
              align="right"
              className="hidden lg:table-cell"
            >
              {t("tax")}
            </SortableTableHead>
            <SortableTableHead
              colKey="source"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
              className="hidden sm:table-cell"
            >
              {t("source")}
            </SortableTableHead>
            <SortableTableHead
              colKey="netAmount"
              sortKey={sortKey}
              sortDir={sortDir}
              onToggle={onToggleSort}
              align="right"
            >
              {t("amount")}
            </SortableTableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((tx, i) => {
            const netAmount = txNetAmount(tx);
            const isSelected = selected.has(tx.id);
            const anomaly = anomalyByTxId.get(tx.id);
            const status = tx.status ?? "normal";
            const monthKey = tx.executedAt.slice(0, 7);
            const showBand =
              groupByMonth && (i === 0 || rows[i - 1].executedAt.slice(0, 7) !== monthKey);
            return (
              <Fragment key={tx.id}>
                {showBand && (
                  <tr role="presentation">
                    <td
                      colSpan={colSpan}
                      className="bg-card-2 px-[22px] py-[9px] text-micro font-bold uppercase tracking-label text-text-2"
                    >
                      {monthFmt.format(new Date(tx.executedAt))}
                    </td>
                  </tr>
                )}
                <TableRow
                  data-state={isSelected ? "selected" : undefined}
                  className={`select-none ${status === "archived" ? "opacity-50" : ""} ${
                    status === "draft" ? "bg-warning/5" : ""
                  }`}
                  {...longPressHandlers(tx.id)}
                >
                  <TableCell className="w-16">
                    {selectionMode && (
                      <Checkbox
                        className="size-4"
                        aria-label={tb("selectRow")}
                        checked={isSelected}
                        onCheckedChange={() => onToggle(tx.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                  </TableCell>
                  <TableCell className="tabular whitespace-nowrap text-xs font-semibold text-text-2">
                    {rowDate(tx.executedAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-3">
                      <TypeIconChip type={tx.type} kind={tx.kind} />
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-[7px]">
                          <span className="truncate text-sm font-bold">
                            {tx.kind && KIND_ICON[tx.kind] ? tt(tx.kind) : tt(tx.type)}
                            {tx.instrument?.symbol ? " · " : ""}
                            {tx.instrumentId && tx.instrument?.symbol ? (
                              <ScopeLink
                                href={`/instruments/${tx.instrumentId}`}
                                onClick={(e) => e.stopPropagation()}
                                className="hover:underline"
                              >
                                {tx.instrument.symbol}
                              </ScopeLink>
                            ) : (
                              (tx.instrument?.symbol ?? "")
                            )}
                          </span>
                          {anomaly && (
                            <InfoTip
                              label={anomalyLabel(anomaly, ta as AnomalyTranslator, locale)}
                              focusable
                            >
                              <span
                                aria-label={anomalyLabel(anomaly, ta as AnomalyTranslator, locale)}
                              >
                                {anomaly.severity === "error" ? (
                                  <AlertCircle className="size-3.5 shrink-0 text-destructive" />
                                ) : (
                                  <AlertTriangle className="size-3.5 shrink-0 text-warning" />
                                )}
                              </span>
                            </InfoTip>
                          )}
                          {status === "draft" && (
                            <Badge variant="outline" className="border-warning/50 text-warning">
                              {tm("status.badgeDraft")}
                            </Badge>
                          )}
                          {status === "draft" && tx.needsReview && (
                            <InfoTip label={tm("status.needsReview")} focusable>
                              <span
                                className="inline-flex items-center"

                                aria-label={tm("status.needsReview")}
                              >
                                <AlertTriangle className="size-3.5 text-warning" />
                              </span>
                            </InfoTip>
                          )}
                          {status === "archived" && (
                            <Badge variant="outline">{tm("status.badgeArchived")}</Badge>
                          )}
                          {status === "cash_neutral" && (
                            <Badge variant="outline">{tm("status.badgeCashNeutral")}</Badge>
                          )}
                        </div>
                        <div className="truncate text-xs font-medium text-text-2">
                          {tx.instrument?.displayName ?? tx.instrument?.name ?? t("cashLabel")}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  {showPortfolio && (
                    <TableCell className="text-xs font-medium text-text-2">
                      {tx.portfolioName ?? "—"}
                    </TableCell>
                  )}
                  <TableCell numeric className="text-body-sm font-semibold text-text-2">
                    {Number(tx.quantity) || rowQuantityDisplay(tx) || "—"}
                  </TableCell>
                  <TableCell numeric className="text-body-sm font-semibold">
                    {Number(tx.quantity) > 0
                      ? m(Number(tx.price), tx.currency)
                      : (rowPerShareDisplay(tx, m) ?? "—")}
                  </TableCell>
                  <TableCell
                    numeric
                    className="hidden text-body-sm font-semibold text-text-2 lg:table-cell"
                  >
                    {tx.tax != null && Number(tx.tax) !== 0 ? m(Number(tx.tax), tx.currency) : "—"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex flex-wrap items-center gap-1">
                      <SourceChips
                        tx={tx}
                        t={t}
                        chipClassName="inline-flex items-center whitespace-nowrap rounded-xs px-2 py-[3px] text-micro font-bold uppercase"
                      />
                    </div>
                  </TableCell>
                  <TableCell
                    numeric
                    className={`text-body-sm font-bold ${netAmount > 0 ? "text-success" : ""}`}
                  >
                    {m(netAmount, tx.currency)}
                  </TableCell>
                  <TableCell className="w-10 pr-2 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      aria-label={tm("viewDetails")}
                      onClick={() => onRowActivate(tx)}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              </Fragment>
            );
          })}
          {showEmpty && (
            <TableRow>
              <TableCell
                colSpan={colSpan}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                {hasActiveFilter ? t("noResults") : t("empty")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

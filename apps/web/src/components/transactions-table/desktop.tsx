"use client";

import { Fragment } from "react";
import { useTranslations, useLocale } from "next-intl";
import { AlertCircle, AlertTriangle, ListChecks } from "lucide-react";
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
  allSelected,
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
  allSelected: boolean;
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
    <div className="hidden overflow-x-auto rounded-xl bg-card shadow-card md:block">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">
              {selectionMode ? (
                <input
                  type="checkbox"
                  className="size-4 align-middle accent-primary"
                  aria-label={tb("selectAll")}
                  checked={allSelected}
                  onChange={onToggleAll}
                />
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  title={tb("selectRows")}
                  aria-label={tb("selectRows")}
                  onClick={onEnterSelectionMode}
                >
                  <ListChecks className="size-4" />
                </Button>
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
                      className="bg-card-2 px-[22px] py-[9px] text-[11px] font-bold uppercase tracking-[0.05em] text-text-3"
                    >
                      {monthFmt.format(new Date(tx.executedAt))}
                    </td>
                  </tr>
                )}
                <TableRow
                  data-state={isSelected ? "selected" : undefined}
                  className={`cursor-pointer select-none ${status === "archived" ? "opacity-50" : ""} ${
                    status === "draft" ? "bg-amber-50/40 dark:bg-amber-950/10" : ""
                  }`}
                  onClick={() => onRowActivate(tx)}
                  {...longPressHandlers(tx.id)}
                >
                  <TableCell className="w-16">
                    {selectionMode && (
                      <span onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="size-4 align-middle accent-primary"
                          aria-label={tb("selectRow")}
                          checked={isSelected}
                          onChange={() => onToggle(tx.id)}
                        />
                      </span>
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
                            {tx.instrument?.symbol ? ` · ${tx.instrument.symbol}` : ""}
                          </span>
                          {anomaly && (
                            <span
                              title={anomalyLabel(anomaly, ta as AnomalyTranslator, locale)}
                              aria-label={anomalyLabel(anomaly, ta as AnomalyTranslator, locale)}
                            >
                              {anomaly.severity === "error" ? (
                                <AlertCircle className="size-3.5 shrink-0 text-destructive" />
                              ) : (
                                <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                              )}
                            </span>
                          )}
                          {status === "draft" && (
                            <Badge
                              variant="outline"
                              className="border-amber-400/50 text-amber-600 dark:text-amber-400"
                            >
                              {tm("status.badgeDraft")}
                            </Badge>
                          )}
                          {status === "draft" && tx.needsReview && (
                            <span
                              className="inline-flex items-center"
                              title={tm("status.needsReview")}
                              aria-label={tm("status.needsReview")}
                            >
                              <AlertTriangle className="size-3.5 text-amber-500" />
                            </span>
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
                  <TableCell className="tabular text-right text-[13px] font-semibold text-text-2">
                    {Number(tx.quantity) || rowQuantityDisplay(tx) || "—"}
                  </TableCell>
                  <TableCell className="tabular text-right text-[13px] font-semibold">
                    {Number(tx.quantity) > 0
                      ? m(Number(tx.price), tx.currency)
                      : (rowPerShareDisplay(tx, m) ?? "—")}
                  </TableCell>
                  <TableCell className="tabular hidden text-right text-[13px] font-semibold text-text-2 lg:table-cell">
                    {tx.tax != null && Number(tx.tax) !== 0 ? m(Number(tx.tax), tx.currency) : "—"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex flex-wrap items-center gap-1">
                      <SourceChips
                        tx={tx}
                        t={t}
                        chipClassName="inline-flex items-center whitespace-nowrap rounded-[7px] px-2 py-[3px] text-[9px] font-bold uppercase"
                      />
                    </div>
                  </TableCell>
                  <TableCell
                    className={`tabular text-right text-sm font-bold ${netAmount > 0 ? "text-success" : ""}`}
                  >
                    {m(netAmount, tx.currency)}
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

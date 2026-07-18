"use client";

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Info } from "lucide-react";
import type { Trade } from "@portfolio/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { TradeDetailSheet } from "@/components/trade-detail-sheet";
import { formatSignedMoney, cn } from "@/lib/utils";
import { useTableSort } from "@/lib/table-sort";
import { type StatusFilter, COLS, tradeKey } from "./trades-table/constants";
import { FilterBar } from "./trades-table/filter-bar";
import { DesktopRow } from "./trades-table/desktop-row";
import { MobileRow } from "./trades-table/mobile-row";

export interface TradesTableProps {
  trades: Trade[];
  currency: string;
}

export function TradesTable({ trades, currency }: TradesTableProps) {
  const t = useTranslations("Trades");
  const locale = useLocale();
  const { sortKey, sortDir, toggle, sort } = useTableSort<Trade>(COLS);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Closed trades open the detail sheet (matches the design); open positions have no
  // exit date/price, so they keep the inline leg-expansion below instead.
  const [detailTrade, setDetailTrade] = useState<Trade | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");

  const signed = (n: number) => formatSignedMoney(n, currency, locale);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trades.filter((tr) => {
      if (statusFilter !== "all" && tr.status !== statusFilter) return false;
      if (!q) return true;
      const symbol = tr.instrument?.symbol?.toLowerCase() ?? "";
      const name = (tr.instrument?.displayName ?? tr.instrument?.name ?? "").toLowerCase();
      return symbol.includes(q) || name.includes(q);
    });
  }, [trades, statusFilter, query]);
  const visible = useMemo(() => sort(filtered), [filtered, sort]);

  // Totals footer — closed trades only (an open position's realized P&L isn't final).
  const closedTotal = useMemo(
    () =>
      trades
        .filter((tr) => tr.status === "closed")
        .reduce((s, tr) => s + Number(tr.realizedPnL), 0),
    [trades],
  );

  const toggleRow = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-3">
      <FilterBar
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        query={query}
        setQuery={setQuery}
      />

      {visible.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-sm text-muted-foreground shadow-card">
          {t("noMatches")}
        </div>
      ) : (
        <div className="rounded-xl bg-card shadow-card">
          {/* ── Desktop table (lg+) ── */}
          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead
                    colKey="instrument"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                  >
                    {t("instrument")}
                  </SortableTableHead>
                  <SortableTableHead
                    colKey="entryDate"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                    className="whitespace-nowrap"
                  >
                    {t("period")}
                  </SortableTableHead>
                  <SortableTableHead
                    colKey="held"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                    align="right"
                    className="whitespace-nowrap"
                  >
                    {t("held")}
                  </SortableTableHead>
                  <SortableTableHead
                    colKey="invested"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                    align="right"
                    className="whitespace-nowrap"
                  >
                    {t("invested")}
                  </SortableTableHead>
                  <SortableTableHead
                    colKey="realized"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                    align="right"
                    className="whitespace-nowrap"
                  >
                    {t("realized")}
                  </SortableTableHead>
                  <SortableTableHead
                    colKey="dividends"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                    align="right"
                    className="whitespace-nowrap"
                  >
                    {t("dividends")}
                  </SortableTableHead>
                  <SortableTableHead
                    colKey="totalReturn"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                    align="right"
                    className="whitespace-nowrap"
                  >
                    {t("totalReturn")}
                  </SortableTableHead>
                  <SortableTableHead
                    colKey="annualized"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                    align="right"
                    className="whitespace-nowrap"
                  >
                    <span className="inline-flex items-center gap-1" title={t("annualizedTooltip")}>
                      {t("annualized")}
                      <Info className="size-3 text-muted-foreground" aria-hidden />
                    </span>
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((tr) => (
                  <DesktopRow
                    key={tradeKey(tr)}
                    tr={tr}
                    currency={currency}
                    expanded={expanded}
                    onDetail={setDetailTrade}
                    onToggle={toggleRow}
                  />
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4}>{t("totalRealized")}</TableCell>
                  <TableCell
                    className={cn(
                      "tabular text-right text-[13px]",
                      closedTotal > 0 ? "text-success" : closedTotal < 0 ? "text-destructive" : "",
                    )}
                  >
                    {signed(closedTotal)}
                  </TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {/* ── Mobile list (< lg) ── */}
          <div className="divide-y divide-border lg:hidden">
            {visible.map((tr) => (
              <MobileRow key={tradeKey(tr)} tr={tr} currency={currency} onSelect={setDetailTrade} />
            ))}
          </div>
        </div>
      )}

      <TradeDetailSheet
        trade={detailTrade}
        currency={currency}
        open={detailTrade !== null}
        onOpenChange={(o) => !o && setDetailTrade(null)}
      />
    </div>
  );
}

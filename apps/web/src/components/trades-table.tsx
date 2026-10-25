"use client";

import { Card } from "@/components/ui/card";
import { signToneClass } from "@/lib/tone";
import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
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
import { type StatusFilter, type PnlFilter, COLS, tradeKey } from "./trades-table/constants";
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
  const [detailTrade, setDetailTrade] = useState<Trade | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [yearFilter, setYearFilter] = useState<string | null>(null);
  const [pnlFilter, setPnlFilter] = useState<PnlFilter>("all");
  const [query, setQuery] = useState("");

  const signed = (n: number) => formatSignedMoney(n, currency, locale);

  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    for (const tr of trades) {
      if (tr.entryDate) years.add(tr.entryDate.slice(0, 4));
      if (tr.exitDate) years.add(tr.exitDate.slice(0, 4));
    }
    return [...years].sort().reverse();
  }, [trades]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trades.filter((tr) => {
      if (statusFilter !== "all" && tr.status !== statusFilter) return false;
      if (yearFilter) {
        const entryYear = tr.entryDate?.slice(0, 4);
        const exitYear = tr.exitDate?.slice(0, 4);
        if (entryYear !== yearFilter && exitYear !== yearFilter) return false;
      }
      if (pnlFilter !== "all") {
        const ret = Number(tr.totalReturn);
        // Neutrals (ret === 0) pass through both Gain and Loss chips; fall through
        // to the text-search check below rather than returning early so the user
        // can still narrow neutrals by symbol/name.
        if (ret < 0 && pnlFilter === "gain") return false;
        if (ret > 0 && pnlFilter === "loss") return false;
      }
      if (!q) return true;
      const symbol = tr.instrument?.symbol?.toLowerCase() ?? "";
      const name = (tr.instrument?.displayName ?? tr.instrument?.name ?? "").toLowerCase();
      return symbol.includes(q) || name.includes(q);
    });
  }, [trades, statusFilter, yearFilter, pnlFilter, query]);
  const visible = useMemo(() => sort(filtered), [filtered, sort]);

  // Totals footer — closed trades only (an open position's realized P&L isn't final).
  const closedTotal = useMemo(
    () =>
      trades
        .filter((tr) => tr.status === "closed")
        .reduce((s, tr) => s + Number(tr.realizedPnL), 0),
    [trades],
  );

  return (
    <div className="space-y-3">
      <FilterBar
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        yearFilter={yearFilter}
        setYearFilter={setYearFilter}
        yearOptions={yearOptions}
        pnlFilter={pnlFilter}
        setPnlFilter={setPnlFilter}
        query={query}
        setQuery={setQuery}
      />

      {visible.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{t("noMatches")}</Card>
      ) : (
        <Card>
          {/* ── Desktop table (lg+) ── */}
          <div className="hidden lg:block">
            <Table stickyHeader caption={t("title")}>
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
                    hint={t("annualizedTooltip")}
                  >
                    {t("annualized")}
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((tr) => (
                  <DesktopRow
                    key={tradeKey(tr)}
                    tr={tr}
                    currency={currency}
                    onDetail={setDetailTrade}
                  />
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4}>{t("totalRealized")}</TableCell>
                  <TableCell numeric className={cn("text-body-sm", signToneClass(closedTotal))}>
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
        </Card>
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

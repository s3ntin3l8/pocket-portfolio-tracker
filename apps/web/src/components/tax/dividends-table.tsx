"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useTableSort, type ColDef } from "@/lib/table-sort";
import { formatMoney } from "@/lib/utils";
import type { TaxCurrencyTotal, TaxDividendRow } from "@/lib/server-api";

const DIVIDEND_COLS: ColDef<TaxDividendRow>[] = [
  { key: "source", get: (r) => r.symbol, type: "text" },
  { key: "gross", get: (r) => Number(r.gross), type: "numeric" },
  { key: "tax", get: (r) => Number(r.tax), type: "numeric" },
  { key: "net", get: (r) => Number(r.net), type: "numeric" },
];

/** "Dividends · {rate}% withheld" table — per-instrument gross/tax/net for the tax year,
 *  aggregated from raw dividend/coupon/interest transactions (their `tax` field).
 *
 *  Unlike every other number on this screen, these amounts are NOT FX-converted (no rate
 *  lookup is available from the web tier) — each row renders in its OWN currency
 *  (`r.currency`), and the total row joins one amount per currency present (the same
 *  "don't sum across currencies" pattern `CashOnHandCard` uses), rather than mislabeling
 *  everything with the holder's display currency.
 *
 *  Client component (uses `useTableSort`) — `t` is derived via `useTranslations` since
 *  function props can't cross the server→client boundary (see disposal-table.tsx's
 *  identical comment). */
export function DividendsTable({
  rows,
  totalsByCurrency,
  locale,
  year,
}: {
  rows: TaxDividendRow[];
  totalsByCurrency: TaxCurrencyTotal[];
  locale: string;
  year: number;
}) {
  const t = useTranslations("Tax");
  const fmt = (n: string | number, currency: string) => formatMoney(Number(n), currency, locale);
  const joinTotals = (field: "gross" | "tax" | "net") =>
    totalsByCurrency.map((tc) => fmt(tc[field], tc.currency)).join(" · ");
  const { sortKey, sortDir, toggle, sort } = useTableSort<TaxDividendRow>(DIVIDEND_COLS);
  const sorted = sort(rows);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("dividendsTable.title")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pt-0">
        {rows.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            {t("dividendsTable.empty", { year })}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead
                  colKey="source"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                >
                  {t("dividendsTable.source")}
                </SortableTableHead>
                <SortableTableHead
                  colKey="gross"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                  align="right"
                >
                  {t("dividendsTable.gross")}
                </SortableTableHead>
                <SortableTableHead
                  colKey="tax"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                  align="right"
                >
                  {t("dividendsTable.tax")}
                </SortableTableHead>
                <SortableTableHead
                  colKey="net"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                  align="right"
                >
                  {t("dividendsTable.net")}
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r, i) => (
                <TableRow key={`${r.symbol}:${r.currency}:${i}`}>
                  <TableCell className="font-medium">{r.symbol}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {fmt(r.gross, r.currency)}
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">
                    {fmt(r.tax, r.currency)}
                  </TableCell>
                  <TableCell className="tabular text-right text-emerald-600 dark:text-emerald-400">
                    {fmt(r.net, r.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">{t("dividendsTable.total")}</TableCell>
                <TableCell className="tabular text-right font-semibold">
                  {joinTotals("gross")}
                </TableCell>
                <TableCell className="tabular text-right font-semibold">
                  {joinTotals("tax")}
                </TableCell>
                <TableCell className="tabular text-right font-semibold text-emerald-600 dark:text-emerald-400">
                  {joinTotals("net")}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

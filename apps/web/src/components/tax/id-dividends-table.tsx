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
import type { IdDividendTax } from "@portfolio/core";

const ID_DIVIDEND_COLS: ColDef<IdDividendTax>[] = [
  { key: "source", get: (r) => r.symbol, type: "text" },
  { key: "gross", get: (r) => Number(r.gross), type: "numeric" },
  { key: "tax", get: (r) => Number(r.tax), type: "numeric" },
  { key: "net", get: (r) => Number(r.net), type: "numeric" },
];

/** "Dividends & coupons · 10% final" table — tax/net computed as a flat 10% of gross
 *  (not the broker-recorded withholding — see `indonesianFinalTax`'s doc comment). */
export function IdDividendsTable({
  rows,
  totalDividendGross,
  totalDividendTax,
  totalDividendNet,
  currency,
  locale,
  year,
}: {
  rows: IdDividendTax[];
  totalDividendGross: string;
  totalDividendTax: string;
  totalDividendNet: string;
  currency: string;
  locale: string;
  year: number;
}) {
  const t = useTranslations("Tax");
  const fmt = (n: string | number) => formatMoney(Number(n), currency, locale);
  const { sortKey, sortDir, toggle, sort } = useTableSort<IdDividendTax>(ID_DIVIDEND_COLS);
  const sorted = sort(rows);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("id.dividendsTable.title")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pt-0">
        {rows.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            {t("id.dividendsTable.empty", { year })}
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
                  {t("id.dividendsTable.source")}
                </SortableTableHead>
                <SortableTableHead
                  colKey="gross"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                  align="right"
                >
                  {t("id.dividendsTable.gross")}
                </SortableTableHead>
                <SortableTableHead
                  colKey="tax"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                  align="right"
                >
                  {t("id.dividendsTable.tax")}
                </SortableTableHead>
                <SortableTableHead
                  colKey="net"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggle}
                  align="right"
                >
                  {t("id.dividendsTable.net")}
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r, i) => (
                <TableRow key={`${r.symbol}:${r.currency}:${i}`}>
                  <TableCell className="font-medium">{r.symbol}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {fmt(r.gross)}
                  </TableCell>
                  <TableCell className="tabular text-right font-semibold">{fmt(r.tax)}</TableCell>
                  <TableCell className="tabular text-right text-emerald-600 dark:text-emerald-400">
                    {fmt(r.net)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-semibold">{t("id.dividendsTable.total")}</TableCell>
                <TableCell className="tabular text-right font-semibold text-muted-foreground">
                  {fmt(totalDividendGross)}
                </TableCell>
                <TableCell className="tabular text-right font-semibold">
                  {fmt(totalDividendTax)}
                </TableCell>
                <TableCell className="tabular text-right font-semibold text-emerald-600 dark:text-emerald-400">
                  {fmt(totalDividendNet)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

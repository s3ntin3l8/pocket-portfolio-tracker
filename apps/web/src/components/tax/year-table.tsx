"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useTableSort, type ColDef } from "@/lib/table-sort";
import { formatMoney } from "@/lib/utils";
import type { TaxYearRow } from "@/lib/server-api";
import type { IdYearTax } from "@portfolio/core";

const BY_YEAR_COLS: ColDef<TaxYearRow>[] = [
  { key: "year", get: (r) => r.year, type: "numeric" },
  { key: "realized", get: (r) => Number(r.realized), type: "numeric" },
  { key: "dividends", get: (r) => Number(r.dividends), type: "numeric" },
  { key: "fsaUsed", get: (r) => Number(r.fsaUsed), type: "numeric" },
  { key: "tax", get: (r) => Number(r.tax), type: "numeric" },
];

/** "By year" table — union of years with realized gains or dividend/interest income,
 *  newest first, plus a per-year estimated tax figure. See `loadTaxYearDetail`'s doc
 *  comment for the estimate's known limits (not TF-adjusted, current allowance applied
 *  uniformly to history). */
export function ByYearTable({
  rows,
  currency,
  locale,
}: {
  rows: TaxYearRow[];
  currency: string;
  locale: string;
}) {
  const t = useTranslations("Tax");
  const fmt = (n: string | number) => formatMoney(Number(n), currency, locale);
  const { sortKey, sortDir, toggle, sort } = useTableSort<TaxYearRow>(BY_YEAR_COLS);
  if (rows.length === 0) return null;
  const sorted = sort(rows);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("byYear.title")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTableHead
                colKey="year"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
              >
                {t("byYear.year")}
              </SortableTableHead>
              <SortableTableHead
                colKey="realized"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
                align="right"
              >
                {t("byYear.realized")}
              </SortableTableHead>
              <SortableTableHead
                colKey="dividends"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
                align="right"
              >
                {t("byYear.dividends")}
              </SortableTableHead>
              <SortableTableHead
                colKey="fsaUsed"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
                align="right"
              >
                {t("byYear.fsaUsed")}
              </SortableTableHead>
              <SortableTableHead
                colKey="tax"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
                align="right"
              >
                {t("byYear.tax")}
              </SortableTableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((y) => (
              <TableRow key={y.year}>
                <TableCell className="font-semibold">{y.year}</TableCell>
                <TableCell className="tabular text-right font-medium text-emerald-600 dark:text-emerald-400">
                  {fmt(y.realized)}
                </TableCell>
                <TableCell className="tabular text-right text-muted-foreground">
                  {fmt(y.dividends)}
                </TableCell>
                <TableCell className="tabular text-right text-muted-foreground">
                  {fmt(y.fsaUsed)}
                </TableCell>
                <TableCell className="tabular text-right font-semibold">{fmt(y.tax)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

const ID_BY_YEAR_COLS: ColDef<IdYearTax>[] = [
  { key: "year", get: (r) => r.year, type: "numeric" },
  { key: "realized", get: (r) => Number(r.realized), type: "numeric" },
  { key: "dividends", get: (r) => Number(r.dividends), type: "numeric" },
  { key: "tax", get: (r) => Number(r.tax), type: "numeric" },
];

/** "By year" table for the Indonesian view — Est. tax is real for every year (proceeds
 *  × 0.1% + dividend gross × 10%), unlike the German table which only has a precise
 *  figure for the selected year (see `loadTaxYearDetail`'s idByYear rollup). */
export function IdByYearTable({
  rows,
  currency,
  locale,
}: {
  rows: IdYearTax[];
  currency: string;
  locale: string;
}) {
  const t = useTranslations("Tax");
  const fmt = (n: string | number) => formatMoney(Number(n), currency, locale);
  const { sortKey, sortDir, toggle, sort } = useTableSort<IdYearTax>(ID_BY_YEAR_COLS);
  if (rows.length === 0) return null;
  const sorted = sort(rows);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("id.byYear.title")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTableHead
                colKey="year"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
              >
                {t("id.byYear.year")}
              </SortableTableHead>
              <SortableTableHead
                colKey="realized"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
                align="right"
              >
                {t("id.byYear.realized")}
              </SortableTableHead>
              <SortableTableHead
                colKey="dividends"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
                align="right"
              >
                {t("id.byYear.dividends")}
              </SortableTableHead>
              <SortableTableHead
                colKey="tax"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
                align="right"
              >
                {t("id.byYear.tax")}
              </SortableTableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((y) => (
              <TableRow key={y.year}>
                <TableCell className="font-semibold">{y.year}</TableCell>
                <TableCell className="tabular text-right font-medium text-emerald-600 dark:text-emerald-400">
                  {fmt(y.realized)}
                </TableCell>
                <TableCell className="tabular text-right text-muted-foreground">
                  {fmt(y.dividends)}
                </TableCell>
                <TableCell className="tabular text-right font-semibold">{fmt(y.tax)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useTableSort, type ColDef } from "@/lib/table-sort";
import { signToneClass } from "@/lib/tone";
import { cn, formatMoney } from "@/lib/utils";
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
        <Table edgeAffordance className="min-w-[560px]">
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
                <TableCell numeric className={cn("font-medium", signToneClass(Number(y.realized)))}>
                  {fmt(y.realized)}
                </TableCell>
                <TableCell numeric className="text-muted-foreground">
                  {fmt(y.dividends)}
                </TableCell>
                <TableCell numeric className="text-muted-foreground">
                  {fmt(y.fsaUsed)}
                </TableCell>
                <TableCell numeric className="font-semibold">
                  {fmt(y.tax)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {/* The selected year's row comes from the allowance calculation: income and
            realized gains are Tf-adjusted, and loss netting lands in FSA used / the tax.
            Earlier rows are gross estimates (see loadTaxYearDetail). Two bases in one
            table — so say so rather than let the rows read as comparable. */}
        <p className="px-4 pt-3 text-micro font-medium text-text-mute">{t("byYear.note")}</p>
      </CardContent>
    </Card>
  );
}

const ID_BY_YEAR_COLS: ColDef<IdYearTax>[] = [
  { key: "year", get: (r) => r.year, type: "numeric" },
  { key: "realized", get: (r) => Number(r.realized), type: "numeric" },
  { key: "income", get: (r) => Number(r.income), type: "numeric" },
  { key: "foreignIncome", get: (r) => Number(r.foreignIncome), type: "numeric" },
  { key: "tax", get: (r) => Number(r.tax), type: "numeric" },
];

/** "By year" table for the Indonesian view — Est. tax is real for every year (proceeds
 *  × 0.1% + each year's Indonesian income at its category's final rate, at today's rates),
 *  unlike the German table which only has a precise figure for the selected year. Foreign
 *  income is shown in its own column and is not in Est. tax. */
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
        <Table edgeAffordance className="min-w-[680px]">
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
                colKey="income"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
                align="right"
              >
                {t("id.byYear.income")}
              </SortableTableHead>
              <SortableTableHead
                colKey="foreignIncome"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
                align="right"
              >
                {t("id.byYear.foreignIncome")}
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
                <TableCell numeric className={cn("font-medium", signToneClass(Number(y.realized)))}>
                  {fmt(y.realized)}
                </TableCell>
                <TableCell numeric className="text-muted-foreground">
                  {fmt(y.income)}
                </TableCell>
                <TableCell numeric className="text-muted-foreground">
                  {fmt(y.foreignIncome)}
                </TableCell>
                <TableCell numeric className="font-semibold">
                  {fmt(y.tax)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

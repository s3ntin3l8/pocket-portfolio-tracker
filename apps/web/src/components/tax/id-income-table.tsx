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
import { formatMoney, formatPercentPoints } from "@/lib/utils";
import type { IdIncomeCategory, IdIncomeTax } from "@portfolio/core";

const ID_INCOME_COLS: ColDef<IdIncomeTax>[] = [
  { key: "source", get: (r) => r.symbol, type: "text" },
  { key: "type", get: (r) => r.category, type: "text" },
  { key: "gross", get: (r) => Number(r.gross), type: "numeric" },
  { key: "tax", get: (r) => Number(r.tax ?? 0), type: "numeric" },
  { key: "net", get: (r) => Number(r.net ?? 0), type: "numeric" },
];

const ID_FOREIGN_COLS: ColDef<IdIncomeTax>[] = [
  { key: "source", get: (r) => r.symbol, type: "text" },
  { key: "gross", get: (r) => Number(r.gross), type: "numeric" },
  { key: "foreignTax", get: (r) => Number(r.foreignTaxWithheld ?? 0), type: "numeric" },
];

/** "10%" for "0.10" — the category's statutory final rate. */
function rateLabel(rate: string | null, locale: string): string | null {
  return rate === null ? null : formatPercentPoints(Number(rate) * 100, locale, 0);
}

/** "Investment income · final tax by type" — the year's Indonesian income, one row per
 *  (instrument, category), each taxed at its own final rate (see `indonesianFinalTax`).
 *  Withheld-at-source tax is labelled as such so it doesn't read as tax still to pay;
 *  foreign income is not in this table (see {@link IdForeignIncomeTable}). */
export function IdIncomeTable({
  rows,
  totalIncomeGross,
  totalIncomeTax,
  totalIncomeNet,
  currency,
  locale,
  year,
}: {
  /** Indonesian rows only (callers drop `category === "foreign"`). */
  rows: IdIncomeTax[];
  totalIncomeGross: string;
  totalIncomeTax: string;
  totalIncomeNet: string;
  currency: string;
  locale: string;
  year: number;
}) {
  const t = useTranslations("Tax");
  const fmt = (n: string | number) => formatMoney(Number(n), currency, locale);
  const { sortKey, sortDir, toggle, sort } = useTableSort<IdIncomeTax>(ID_INCOME_COLS);
  const sorted = sort(rows);
  // One note per category present, in the categories' display order.
  const notes = (
    ["domestic_dividend", "bond_interest", "deposit_interest", "fund_distribution"] as const
  ).filter((c) => rows.some((r) => r.category === c));

  const taxNote = (r: IdIncomeTax): string | null => {
    if (r.withheldAtSource) {
      return r.taxBasis === "recorded"
        ? t("id.incomeTable.withheldRecorded")
        : t("id.incomeTable.withheld");
    }
    if (r.category === "domestic_dividend") return t("id.incomeTable.selfPay");
    if (r.category === "fund_distribution") return t("id.incomeTable.notTaxed");
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("id.incomeTable.title")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pt-0">
        {rows.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            {t("id.incomeTable.empty", { year })}
          </p>
        ) : (
          <>
            <Table edgeAffordance className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <SortableTableHead
                    colKey="source"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                  >
                    {t("id.incomeTable.source")}
                  </SortableTableHead>
                  <SortableTableHead
                    colKey="type"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                  >
                    {t("id.incomeTable.type")}
                  </SortableTableHead>
                  <SortableTableHead
                    colKey="gross"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                    align="right"
                  >
                    {t("id.incomeTable.gross")}
                  </SortableTableHead>
                  <SortableTableHead
                    colKey="tax"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                    align="right"
                  >
                    {t("id.incomeTable.tax")}
                  </SortableTableHead>
                  <SortableTableHead
                    colKey="net"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggle}
                    align="right"
                  >
                    {t("id.incomeTable.net")}
                  </SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((r, i) => {
                  const note = taxNote(r);
                  return (
                    // Merged holder payloads can repeat an instrument: the index keeps keys unique.
                    <TableRow key={`${r.instrumentId ?? r.symbol}:${r.category}:${i}`}>
                      <TableCell className="font-medium">{r.symbol}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {t(`id.category.${r.category}`)}
                        {r.rate !== null && ` · ${rateLabel(r.rate, locale)}`}
                      </TableCell>
                      <TableCell numeric className="text-muted-foreground">
                        {fmt(r.gross)}
                      </TableCell>
                      <TableCell numeric>
                        <span className="font-semibold">{fmt(r.tax ?? 0)}</span>
                        {note && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {note}
                          </span>
                        )}
                      </TableCell>
                      <TableCell numeric className="text-success">
                        {fmt(r.net ?? 0)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold" colSpan={2}>
                    {t("id.incomeTable.total")}
                  </TableCell>
                  <TableCell numeric className="font-semibold text-muted-foreground">
                    {fmt(totalIncomeGross)}
                  </TableCell>
                  <TableCell numeric className="font-semibold">
                    {fmt(totalIncomeTax)}
                  </TableCell>
                  <TableCell numeric className="font-semibold text-success">
                    {fmt(totalIncomeNet)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
            <ul className="mt-3 space-y-1 px-6 text-xs leading-relaxed text-muted-foreground">
              {notes.map((c: IdIncomeCategory) => (
                <li key={c}>{t(`id.notes.${c}`)}</li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** "Foreign income · not in the estimate" — foreign-source income is ordinary income at the
 *  holder's marginal rate with a foreign tax credit, which Pocket can't compute, so it is
 *  listed with the foreign tax withheld and kept out of every final-tax total. Renders
 *  nothing when there is no foreign income. */
export function IdForeignIncomeTable({
  rows,
  foreignIncomeGross,
  foreignTaxWithheld,
  currency,
  locale,
}: {
  /** Foreign rows only (`category === "foreign"`). */
  rows: IdIncomeTax[];
  foreignIncomeGross: string;
  foreignTaxWithheld: string;
  currency: string;
  locale: string;
}) {
  const t = useTranslations("Tax");
  const fmt = (n: string | number) => formatMoney(Number(n), currency, locale);
  const { sortKey, sortDir, toggle, sort } = useTableSort<IdIncomeTax>(ID_FOREIGN_COLS);
  if (rows.length === 0) return null;
  const sorted = sort(rows);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("id.foreignTable.title")}</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pt-0">
        <Table edgeAffordance className="min-w-[480px]">
          <TableHeader>
            <TableRow>
              <SortableTableHead
                colKey="source"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
              >
                {t("id.foreignTable.source")}
              </SortableTableHead>
              <SortableTableHead
                colKey="gross"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
                align="right"
              >
                {t("id.foreignTable.gross")}
              </SortableTableHead>
              <SortableTableHead
                colKey="foreignTax"
                sortKey={sortKey}
                sortDir={sortDir}
                onToggle={toggle}
                align="right"
              >
                {t("id.foreignTable.foreignTax")}
              </SortableTableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r, i) => (
              <TableRow key={`${r.instrumentId ?? r.symbol}:${i}`}>
                <TableCell className="font-medium">{r.symbol}</TableCell>
                <TableCell numeric>{fmt(r.gross)}</TableCell>
                <TableCell numeric className="text-muted-foreground">
                  {fmt(r.foreignTaxWithheld ?? 0)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">{t("id.foreignTable.total")}</TableCell>
              <TableCell numeric className="font-semibold">
                {fmt(foreignIncomeGross)}
              </TableCell>
              <TableCell numeric className="font-semibold text-muted-foreground">
                {fmt(foreignTaxWithheld)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        <p className="mt-3 px-6 text-xs leading-relaxed text-muted-foreground">
          {t("id.foreignTable.note")}
        </p>
      </CardContent>
    </Card>
  );
}

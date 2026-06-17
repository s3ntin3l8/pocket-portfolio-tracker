"use client";

import { useTranslations, useLocale } from "next-intl";
import type { HoldingValuation } from "@portfolio/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { Link } from "@/i18n/navigation";
import { formatMoney, cn } from "@/lib/utils";
import { useTableSort } from "@/lib/table-sort";
import type { ColDef } from "@/lib/table-sort";

const HOLDINGS_COLS: ColDef<HoldingValuation>[] = [
  { key: "instrument", get: (h) => h.instrument?.symbol ?? "", type: "text" },
  { key: "quantity", get: (h) => h.quantity, type: "numeric" },
  { key: "avgCost", get: (h) => h.avgCost, type: "numeric" },
  { key: "price", get: (h) => h.price ?? "0", type: "numeric" },
  { key: "value", get: (h) => h.marketValueDisplay ?? "0", type: "numeric" },
  { key: "pnl", get: (h) => h.unrealizedPnLDisplay ?? "0", type: "numeric" },
];

export interface HoldingsTableProps {
  rows: HoldingValuation[];
  currency: string;
}

export function HoldingsTable({ rows, currency }: HoldingsTableProps) {
  const t = useTranslations("Holdings");
  const locale = useLocale();
  const { sortKey, sortDir, toggle, sort } = useTableSort<HoldingValuation>(HOLDINGS_COLS);

  const m = (n: number) => formatMoney(n, currency, locale);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableTableHead colKey="instrument" sortKey={sortKey} sortDir={sortDir} onToggle={toggle}>{t("instrument")}</SortableTableHead>
          <SortableTableHead colKey="quantity" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} className="text-right">{t("quantity")}</SortableTableHead>
          <SortableTableHead colKey="avgCost" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} className="text-right">{t("avgCost")}</SortableTableHead>
          <SortableTableHead colKey="price" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} className="text-right">{t("price")}</SortableTableHead>
          <SortableTableHead colKey="value" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} className="text-right">{t("value")}</SortableTableHead>
          <SortableTableHead colKey="pnl" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} className="text-right">{t("pnl")}</SortableTableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sort(rows).map((h) => {
          const pnl =
            h.unrealizedPnLDisplay !== null
              ? Number(h.unrealizedPnLDisplay)
              : null;
          const native = (n: number) =>
            formatMoney(n, h.currency ?? currency, locale);
          return (
            <TableRow key={h.instrumentId}>
              <TableCell>
                <Link
                  href={`/instruments/${h.instrumentId}`}
                  className="font-medium hover:underline"
                >
                  {h.instrument?.symbol ?? "—"}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {h.instrument?.name ?? h.instrumentId}
                </div>
              </TableCell>
              <TableCell className="tabular text-right">
                {Number(h.quantity)} {h.instrument?.unit ?? ""}
              </TableCell>
              <TableCell className="tabular text-right">
                {native(Number(h.avgCost))}
              </TableCell>
              <TableCell className="tabular text-right">
                {h.price !== null ? native(Number(h.price)) : "—"}
              </TableCell>
              <TableCell className="tabular text-right">
                {h.marketValueDisplay !== null
                  ? m(Number(h.marketValueDisplay))
                  : "—"}
              </TableCell>
              <TableCell
                className={cn(
                  "tabular text-right",
                  pnl === null
                    ? "text-muted-foreground"
                    : pnl >= 0
                      ? "text-success"
                      : "text-destructive",
                )}
              >
                {pnl === null ? "—" : `${pnl >= 0 ? "+" : ""}${m(pnl)}`}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

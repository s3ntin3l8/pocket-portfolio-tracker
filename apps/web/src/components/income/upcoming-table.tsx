"use client";

import { useTranslations, useLocale } from "next-intl";
import type { UpcomingPayment } from "@portfolio/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils";
import { useTableSort } from "@/lib/table-sort";
import type { ColDef } from "@/lib/table-sort";

const COLS: ColDef<UpcomingPayment>[] = [
  { key: "date", get: (c) => c.date, type: "date" },
  { key: "status", get: (c) => c.status, type: "text" },
  { key: "instrument", get: (c) => c.symbol, type: "text" },
  { key: "amount", get: (c) => c.amount, type: "numeric" },
];

export function UpcomingTable({ rows }: { rows: UpcomingPayment[] }) {
  const t = useTranslations("Income");
  const locale = useLocale();
  const df = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const { sortKey, sortDir, toggle, sort } = useTableSort<UpcomingPayment>(COLS);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableTableHead colKey="date" sortKey={sortKey} sortDir={sortDir} onToggle={toggle}>{t("date")}</SortableTableHead>
          <SortableTableHead colKey="status" sortKey={sortKey} sortDir={sortDir} onToggle={toggle}>{t("status")}</SortableTableHead>
          <SortableTableHead colKey="instrument" sortKey={sortKey} sortDir={sortDir} onToggle={toggle}>{t("instrument")}</SortableTableHead>
          <SortableTableHead colKey="amount" sortKey={sortKey} sortDir={sortDir} onToggle={toggle} className="text-right">{t("amount")}</SortableTableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sort(rows).map((c: UpcomingPayment, i: number) => (
          <TableRow key={`${c.instrumentId}-${c.date}-${i}`}>
            <TableCell className="tabular whitespace-nowrap text-muted-foreground">
              {df.format(new Date(c.date))}
            </TableCell>
            <TableCell>
              <Badge
                variant={
                  c.status === "scheduled"
                    ? "default"
                    : c.status === "announced"
                      ? "warning"
                      : c.status === "paid"
                        ? "success"
                        : "outline"
                }
              >
                {t(c.status)}
              </Badge>
            </TableCell>
            <TableCell>
              <div className="font-medium">{c.symbol}</div>
              {c.name && (
                <div className="text-xs text-muted-foreground">{c.name}</div>
              )}
            </TableCell>
            <TableCell className="tabular text-right text-success">
              {formatMoney(Number(c.amount), c.currency, locale)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

"use client";

import { useTranslations, useLocale } from "next-intl";
import type { LotView } from "@portfolio/api-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/utils";

/** Standing open FIFO lots for one instrument (oldest acquisition first). */
export function InstrumentLotsTable({
  lots,
  currency,
}: {
  lots: LotView[];
  currency: string;
}) {
  const t = useTranslations("Instrument");
  const locale = useLocale();
  const qtyFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 8 });
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  if (lots.length === 0) return null;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("lotAcquired")}</TableHead>
          <TableHead className="text-right">{t("lotQty")}</TableHead>
          <TableHead className="text-right">{t("lotPrice")}</TableHead>
          <TableHead className="text-right">{t("lotCost")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lots.map((lot, i) => (
          <TableRow key={`${lot.acqDate}-${i}`}>
            <TableCell>{dateFmt.format(new Date(lot.acqDate))}</TableCell>
            <TableCell className="text-right">
              {qtyFmt.format(Number(lot.qty))}
            </TableCell>
            <TableCell className="text-right">
              {formatMoney(Number(lot.unitCost), currency, locale)}
            </TableCell>
            <TableCell className="text-right">
              {formatMoney(Number(lot.cost), currency, locale)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

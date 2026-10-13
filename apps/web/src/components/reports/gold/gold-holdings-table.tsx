import { useTranslations } from "next-intl";
import type { GoldHoldingRow } from "@portfolio/api-client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TABLE_LABEL,
  TABLE_SUBLABEL,
  TABLE_VALUE,
  TABLE_VALUE_STRONG,
} from "@/components/ui/table";
import { toneOf } from "@/components/gain-figure";
import { formatMoney, formatQuantity, formatSignedMoney } from "@/lib/utils";

/**
 * Every gold holding valued at its buyback rate. A row valued at cost (no usable price) or
 * without an FX rate has no measured gain, so its P&L cell is "—" rather than a green
 * "+0.00"; an FX-less row also shows no display-currency value.
 */
export function GoldHoldingsTable({
  holdings,
  displayCurrency,
  locale,
}: {
  holdings: GoldHoldingRow[];
  displayCurrency: string;
  locale: string;
}) {
  const t = useTranslations("GoldReport");
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colGold")}</TableHead>
            <TableHead className="text-right">{t("colGrams")}</TableHead>
            {/* The per-gram rate is the first thing to go on a phone, so Value and Gain stay in view. */}
            <TableHead className="hidden text-right sm:table-cell">
              {t("colPricePerGram")}
            </TableHead>
            <TableHead className="text-right">{t("colValue")}</TableHead>
            <TableHead className="text-right">{t("colGain")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((h) => {
            const measured = !h.valuedAtCost && !h.fxMissing && h.unrealized !== null;
            const gain = measured ? Number(h.unrealized) : null;
            return (
              <TableRow key={`${h.portfolioId}:${h.instrumentId}`}>
                <TableCell>
                  <div className={TABLE_LABEL}>{h.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className={TABLE_SUBLABEL}>{h.market}</span>
                    {h.valuedAtCost && <Badge variant="warning">{t("atCost")}</Badge>}
                    {h.fxMissing && <Badge variant="warning">{t("noFx")}</Badge>}
                  </div>
                </TableCell>
                <TableCell className={TABLE_VALUE}>
                  {formatQuantity(Number(h.grams), "grams", locale)}
                </TableCell>
                <TableCell className={`${TABLE_VALUE} hidden sm:table-cell`}>
                  {h.pricePerGram !== null && h.currency
                    ? formatMoney(Number(h.pricePerGram), h.currency, locale)
                    : "—"}
                </TableCell>
                <TableCell className={TABLE_VALUE_STRONG}>
                  {h.value !== null && !h.fxMissing
                    ? formatMoney(Number(h.value), displayCurrency, locale)
                    : "—"}
                </TableCell>
                <TableCell
                  className={`${TABLE_VALUE} ${
                    toneOf(gain) === "up"
                      ? "text-success"
                      : toneOf(gain) === "down"
                        ? "text-destructive"
                        : ""
                  }`}
                >
                  {gain !== null ? formatSignedMoney(gain, displayCurrency, locale) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

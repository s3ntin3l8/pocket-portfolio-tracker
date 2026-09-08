"use client";

import { Fragment } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { Trade } from "@portfolio/api-client";
import {
  TableCell,
  TableRow,
  TABLE_LABEL,
  TABLE_SUBLABEL,
  TABLE_VALUE,
  TABLE_VALUE_STRONG,
  TABLE_SUBVALUE,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { InstrumentLogo } from "@/components/instrument-logo";
import { Link } from "@/i18n/navigation";
import { formatMoney, formatSignedMoney, formatPercent, cn } from "@/lib/utils";
import { tradeKey, toneClass } from "./constants";

export function DesktopRow({
  tr,
  currency,
  expanded,
  onDetail,
  onToggle,
}: {
  tr: Trade;
  currency: string;
  expanded: Set<string>;
  onDetail: (tr: Trade) => void;
  onToggle: (key: string) => void;
}) {
  const t = useTranslations("Trades");
  const locale = useLocale();
  const key = tradeKey(tr);
  const ret = Number(tr.totalReturn);
  const realized = Number(tr.realizedPnL);
  const isOpen = expanded.has(key);
  const hasExpandableLegs = tr.status === "open" && tr.legs.length > 0;

  const money = (n: number, ccy = currency) => formatMoney(n, ccy, locale);
  const signed = (n: number) => formatSignedMoney(n, currency, locale);
  const heldLabel = (days: number) =>
    days >= 365 ? `${(days / 365).toFixed(1)}${t("yearsAbbr")}` : `${days}${t("daysAbbr")}`;

  return (
    <Fragment>
      <TableRow>
        <TableCell>
          <div className="relative flex items-center gap-2">
            {hasExpandableLegs ? (
              <button
                type="button"
                aria-label={isOpen ? t("collapseLegs") : t("expandLegs")}
                aria-expanded={isOpen}
                onClick={() => onToggle(key)}
                className="absolute -left-4 inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronRight
                  className={cn("size-4 transition-transform", isOpen && "rotate-90")}
                />
              </button>
            ) : (
              <ChevronRight
                aria-hidden
                className={cn(
                  "absolute -left-4 size-4 text-muted-foreground transition-transform",
                  tr.status === "closed" && "opacity-0",
                )}
              />
            )}
            <InstrumentLogo
              label={tr.instrument?.symbol ?? tr.instrumentId}
              symbol={tr.instrument?.symbol}
              market={tr.instrument?.market}
              assetClass={tr.instrument?.assetClass}
              className="shrink-0"
            />
            <div className="min-w-0 max-w-[180px]">
              <div className="flex min-w-0 items-center gap-1.5">
                <Link
                  href={`/instruments/${tr.instrumentId}`}
                  className={cn(TABLE_LABEL, "min-w-0 truncate hover:underline")}
                >
                  {tr.instrument?.symbol ?? "—"}
                </Link>
                <Badge variant={tr.status === "open" ? "default" : "outline"} className="shrink-0">
                  {t(`status_${tr.status}`)}
                </Badge>
                {tr.status === "closed" && (
                  <button
                    type="button"
                    aria-label={t("showTradeDetail")}
                    onClick={() => onDetail(tr)}
                    className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                )}
              </div>
              <div className={cn(TABLE_SUBLABEL, "truncate")}>
                {tr.instrument?.displayName ?? tr.instrument?.name ?? tr.instrumentId}
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell className={cn(TABLE_SUBLABEL, "whitespace-nowrap")}>
          {tr.entryDate}
          {tr.exitDate ? ` → ${tr.exitDate}` : ""}
        </TableCell>
        <TableCell className={cn(TABLE_VALUE, "whitespace-nowrap")}>
          {heldLabel(tr.holdingDays)}
          {Math.abs(tr.holdingDays - tr.avgHoldingDays) > 7 && (
            <div
              className={cn(TABLE_SUBVALUE, "text-muted-foreground")}
              title={t("avgHeldTooltip")}
            >
              ~{heldLabel(tr.avgHoldingDays)} {t("avgHeld")}
            </div>
          )}
          {tr.longTerm && <div className={cn(TABLE_SUBVALUE, "text-success")}>{t("longTerm")}</div>}
        </TableCell>
        <TableCell className={cn(TABLE_VALUE, "whitespace-nowrap")}>
          {money(Number(tr.invested))}
        </TableCell>
        <TableCell className={cn(TABLE_VALUE_STRONG, "whitespace-nowrap", toneClass(realized))}>
          {realized === 0 ? "—" : signed(realized)}
        </TableCell>
        <TableCell className={cn(TABLE_VALUE, "whitespace-nowrap")}>
          {Number(tr.dividends) === 0 ? "—" : money(Number(tr.dividends))}
        </TableCell>
        <TableCell className={cn(TABLE_VALUE_STRONG, "whitespace-nowrap", toneClass(ret))}>
          {signed(ret)}
          {tr.totalReturnPct !== null && (
            <div className={TABLE_SUBVALUE}>{formatPercent(tr.totalReturnPct, locale)}</div>
          )}
        </TableCell>
        <TableCell
          className={cn(TABLE_VALUE_STRONG, "whitespace-nowrap", toneClass(tr.annualizedPct ?? 0))}
        >
          {tr.annualizedPct === null ? "—" : formatPercent(tr.annualizedPct, locale)}
        </TableCell>
      </TableRow>
      {isOpen && (
        <>
          {tr.legs.map((leg, i) => (
            <TableRow key={`${key}:leg:${i}`} className="bg-muted/40 text-xs">
              <TableCell className="pl-9 text-muted-foreground" colSpan={2}>
                {leg.acqDate} → {leg.sellDate}
              </TableCell>
              <TableCell className="tabular text-right text-muted-foreground">
                {leg.holdingDays >= 365
                  ? `${(leg.holdingDays / 365).toFixed(1)}${t("yearsAbbr")}`
                  : `${leg.holdingDays}${t("daysAbbr")}`}
              </TableCell>
              <TableCell className="tabular text-right">{money(Number(leg.cost))}</TableCell>
              <TableCell className="tabular text-right">{money(Number(leg.proceeds))}</TableCell>
              <TableCell />
              <TableCell className={cn("tabular text-right", toneClass(Number(leg.gain)))}>
                {signed(Number(leg.gain))}
              </TableCell>
              <TableCell className="text-right">
                {leg.longTerm && <span className="text-success">{t("longTerm")}</span>}
              </TableCell>
            </TableRow>
          ))}
          {/* The legs carry no transaction ids, so link to the instrument's
            full transaction list rather than to individual rows. */}
          <TableRow className="bg-muted/40">
            <TableCell colSpan={8} className="pl-9">
              <Link
                href={`/instruments/${tr.instrumentId}`}
                className="text-xs font-medium text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {t("viewTransactions")} →
              </Link>
            </TableCell>
          </TableRow>
        </>
      )}
    </Fragment>
  );
}

"use client";

import { useTranslations, useLocale } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { Trade } from "@portfolio/api-client";
import { TABLE_LABEL, TABLE_SUBLABEL, TABLE_SUBVALUE } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { InstrumentLogo } from "@/components/instrument-logo";
import { Link } from "@/i18n/navigation";
import { formatSignedMoney, formatPercent, cn } from "@/lib/utils";
import { tradeKey, toneClass } from "./constants";

export function MobileRow({
  tr,
  currency,
  onSelect,
}: {
  tr: Trade;
  currency: string;
  onSelect: (tr: Trade) => void;
}) {
  const t = useTranslations("Trades");
  const locale = useLocale();
  const ret = Number(tr.totalReturn);

  const signed = (n: number) => formatSignedMoney(n, currency, locale);
  const heldLabel = (days: number) =>
    days >= 365 ? `${(days / 365).toFixed(1)}${t("yearsAbbr")}` : `${days}${t("daysAbbr")}`;

  return (
    <div key={tradeKey(tr)} className="flex items-start justify-between gap-3 p-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <InstrumentLogo
          label={tr.instrument?.symbol ?? tr.instrumentId}
          symbol={tr.instrument?.symbol}
          market={tr.instrument?.market}
          assetClass={tr.instrument?.assetClass}
          className="mt-0.5 size-[42px] rounded-[13px]"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/instruments/${tr.instrumentId}`}
              className={cn(TABLE_LABEL, "truncate hover:underline")}
            >
              {tr.instrument?.symbol ?? "—"}
            </Link>
            <Badge variant={tr.status === "open" ? "default" : "outline"}>
              {t(`status_${tr.status}`)}
            </Badge>
          </div>
          <div className={cn(TABLE_SUBLABEL, "truncate")}>
            {tr.instrument?.displayName ?? tr.instrument?.name ?? tr.instrumentId}
          </div>
          <div className={TABLE_SUBLABEL}>
            {tr.entryDate}
            {tr.exitDate ? ` → ${tr.exitDate}` : ""} · {heldLabel(tr.holdingDays)}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          aria-label={t("showTradeDetail")}
          onClick={() => onSelect(tr)}
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="size-3.5" />
        </button>
        <div className="text-right tabular">
          <div className={cn("text-sm font-bold", toneClass(ret))}>{signed(ret)}</div>
          {tr.totalReturnPct !== null && (
            <div className={cn(TABLE_SUBVALUE, toneClass(ret))}>
              {formatPercent(tr.totalReturnPct, locale)}
            </div>
          )}
          {tr.annualizedPct !== null && (
            <div
              className={cn(TABLE_SUBVALUE, toneClass(tr.annualizedPct))}
              title={t("annualizedTooltip")}
            >
              {formatPercent(tr.annualizedPct, locale)}
              {t("annualizedAbbr")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

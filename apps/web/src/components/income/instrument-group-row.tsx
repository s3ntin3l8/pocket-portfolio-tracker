"use client";

import { useMemo, Fragment } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatMoney, cn } from "@/lib/utils";
import {
  TIMELINE_GRID,
  TimelineBadge,
  type IncomeEventRow,
  type InstrumentGroup,
} from "@/components/income/timeline-shared";

export function InstrumentGroupRow({
  group,
  expanded,
  onToggle,
  openRow,
  loadingId,
  groupByMonth,
}: {
  group: InstrumentGroup;
  expanded: boolean;
  onToggle: () => void;
  openRow: (e: IncomeEventRow) => void;
  loadingId: string | null;
  groupByMonth?: boolean;
}) {
  const t = useTranslations("Income");
  const tt = useTranslations("TxType");
  const locale = useLocale();
  const df = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const label = group.symbol;
  const allForecast = group.hasForecast && !group.hasReceived;

  const monthFmt = useMemo(
    () =>
      groupByMonth
        ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" })
        : null,
    [locale, groupByMonth],
  );

  const monthTotals = useMemo(() => {
    if (!groupByMonth) return new Map<string, string>();
    const totals = new Map<string, Record<string, number>>();
    for (const r of group.rows) {
      const mk = r.date.slice(0, 7);
      const prev = totals.get(mk) ?? {};
      prev[r.currency] = (prev[r.currency] ?? 0) + Number(r.amount);
      totals.set(mk, prev);
    }
    const result = new Map<string, string>();
    for (const [mk, byCurrency] of totals) {
      result.set(
        mk,
        Object.entries(byCurrency)
          .map(([cur, amt]) => formatMoney(amt, cur, locale))
          .join(" · "),
      );
    }
    return result;
  }, [group.rows, groupByMonth, locale]);

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3.5 border-b border-line px-0.5 py-[11px] text-left hover:bg-muted/40"
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-text-3" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-text-3" />
        )}
        <TimelineBadge label={label} type={group.dominantType} forecast={allForecast} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate text-body-sm font-bold">{label}</span>
          {group.displayName && (
            <span className="truncate text-micro font-medium text-text-2">{group.displayName}</span>
          )}
          {allForecast && (
            <span className="shrink-0 rounded-xs bg-line px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-text-3">
              {t("est")}
            </span>
          )}
        </div>
        <span className="tabular whitespace-nowrap text-right text-sm font-bold text-success">
          {group.totalLabel}
        </span>
      </button>
      {expanded &&
        group.rows.map((e, i) => {
          const mc = e.date.slice(0, 7);
          const showBand = groupByMonth && (i === 0 || group.rows[i - 1].date.slice(0, 7) !== mc);
          const forecast = Boolean(e.status);
          const clickable = !forecast && Boolean(e.transactionId && e.portfolioId);
          const typeLabel = tt(e.type);
          const dateLabel = df.format(new Date(e.date));
          const amountLabel = formatMoney(Number(e.amount), e.currency, locale);
          const amountClass = forecast
            ? "text-text-2"
            : Number(e.amount) >= 0
              ? "text-success"
              : "text-destructive";
          const shares =
            e.quantity != null
              ? Number(e.quantity).toLocaleString(locale, { maximumFractionDigits: 4 })
              : "—";
          const perShare =
            e.perShare != null ? formatMoney(Number(e.perShare), e.currency, locale) : "—";
          const estTag = forecast && (
            <span className="shrink-0 rounded-xs bg-line px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-text-3">
              {t("est")}
            </span>
          );

          return (
            <Fragment key={`${e.instrumentId}-${e.date}-${i}`}>
              {showBand && (
                <div className="bg-card-2 px-0.5 py-[9px] text-micro font-bold uppercase tracking-[0.05em] text-text-3">
                  {monthFmt!.format(new Date(e.date))}
                  <span className="ml-2 font-normal normal-case">{monthTotals.get(mc)}</span>
                </div>
              )}
              <div
                style={forecast ? { opacity: 0.78 } : undefined}
                role={clickable ? "button" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onClick={clickable ? () => openRow(e) : undefined}
                onKeyDown={
                  clickable
                    ? (ev) => {
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          void openRow(e);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "border-t border-line",
                  clickable && "cursor-pointer transition-colors hover:bg-muted/40",
                  loadingId === e.transactionId && "opacity-60",
                )}
              >
                {/* Desktop */}
                <div
                  className={cn(
                    "hidden items-center gap-3.5 pl-10 pr-0.5 py-[11px] sm:grid",
                    TIMELINE_GRID,
                  )}
                >
                  <span className="tabular whitespace-nowrap text-xs font-semibold text-text-2">
                    {dateLabel}
                  </span>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="truncate text-body-sm font-bold">{label}</span>
                    {estTag}
                  </div>
                  <span className="truncate text-xs font-medium text-text-2">{typeLabel}</span>
                  <span className="tabular text-right text-body-sm font-semibold text-text-mute">
                    {shares}
                  </span>
                  <span className="tabular text-right text-body-sm font-semibold text-text-mute">
                    {perShare}
                  </span>
                  <span
                    className={cn(
                      "tabular whitespace-nowrap text-right text-sm font-bold",
                      amountClass,
                    )}
                  >
                    {amountLabel}
                  </span>
                </div>
                {/* Mobile */}
                <div className="flex items-center gap-3 pl-10 pr-0.5 py-[11px] sm:hidden">
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-body-sm font-bold">{label}</span>
                      {estTag}
                    </div>
                    <span className="truncate text-micro font-medium text-text-2">
                      {typeLabel} {" · "} {dateLabel}
                    </span>
                  </div>
                  <span className={cn("tabular shrink-0 text-sm font-bold", amountClass)}>
                    {amountLabel}
                  </span>
                </div>
              </div>
            </Fragment>
          );
        })}
    </div>
  );
}

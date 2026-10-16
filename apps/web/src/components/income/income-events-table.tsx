"use client";

import { signToneClass } from "@/lib/tone";
import { useState, useMemo, Fragment } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatMoney, cn } from "@/lib/utils";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { TransactionDetailSheet } from "@/components/transaction-detail-sheet";
import type { TxRow } from "@/components/transactions-table";

import {
  TIMELINE_GRID,
  TimelineBadge,
  TimelineColumnHeader,
  type IncomeEventRow,
  type InstrumentGroup,
} from "@/components/income/timeline-shared";
import { InstrumentGroupRow } from "@/components/income/instrument-group-row";

// Re-exported so existing importers keep working.
export { TIMELINE_GRID, TimelineColumnHeader };
export type { IncomeEventRow };

export function IncomeEventsTable({
  rows,
  groupByMonth,
  groupByInstrument,
}: {
  rows: IncomeEventRow[];
  groupByMonth?: boolean;
  groupByInstrument?: boolean;
}) {
  const t = useTranslations("Income");
  const tt = useTranslations("TxType");
  const locale = useLocale();
  const df = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
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
    for (const r of rows) {
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
  }, [rows, groupByMonth, locale]);

  const instrumentGroups = useMemo(() => {
    if (!groupByInstrument) return null;
    const map = new Map<string, InstrumentGroup & { typeCounts: Record<string, number> }>();
    for (const r of rows) {
      const key = r.instrumentId ?? r.symbol ?? "—";
      const existing = map.get(key);
      if (existing) {
        existing.totalByCurrency[r.currency] =
          (existing.totalByCurrency[r.currency] ?? 0) + Number(r.amount);
        existing.hasReceived = existing.hasReceived || !r.status;
        existing.hasForecast = existing.hasForecast || Boolean(r.status);
        existing.typeCounts[r.type] = (existing.typeCounts[r.type] ?? 0) + 1;
        existing.rows.push(r);
      } else {
        map.set(key, {
          key,
          symbol: r.symbol ?? "—",
          displayName: r.displayName ?? r.name,
          totalByCurrency: { [r.currency]: Number(r.amount) },
          totalLabel: "",
          hasReceived: !r.status,
          hasForecast: Boolean(r.status),
          dominantType: r.type,
          typeCounts: { [r.type]: 1 },
          rows: [r],
        });
      }
    }
    for (const g of map.values()) {
      g.totalLabel = Object.entries(g.totalByCurrency)
        .map(([cur, amt]) => formatMoney(amt, cur, locale))
        .join(" · ");
      g.dominantType = Object.entries(g.typeCounts).sort((a, b) => b[1] - a[1])[0][0];
      g.rows.sort((a, b) => b.date.localeCompare(a.date));
    }
    return [...map.values()];
  }, [rows, groupByInstrument, locale]);

  const api = useApiClient();
  const router = useRouter();
  const [detailTx, setDetailTx] = useState<TxRow | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (key: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Received (non-forecast) rows carry the underlying transaction id/portfolio — open the
  // same detail sheet used on the Activity page. Forecast rows have no backing transaction.
  const openRow = async (e: IncomeEventRow) => {
    if (!e.transactionId || !e.portfolioId) return;
    setLoadingId(e.transactionId);
    try {
      // Fetch just this row (audit D5: the full-list read is a bounded export now).
      const list = await api.listTransactionsByIds(e.portfolioId, [e.transactionId]);
      setDetailTx(list.find((r) => r.id === e.transactionId) ?? null);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div>
      {groupByInstrument && instrumentGroups
        ? instrumentGroups.map((g) => (
            <InstrumentGroupRow
              key={g.key}
              group={g}
              expanded={expandedGroups.has(g.key)}
              onToggle={() => toggleGroup(g.key)}
              openRow={openRow}
              loadingId={loadingId}
              groupByMonth={groupByMonth}
            />
          ))
        : rows.map((e, i) => {
            const mc = e.date.slice(0, 7);
            const showBand = groupByMonth && (i === 0 || rows[i - 1].date.slice(0, 7) !== mc);
            const forecast = Boolean(e.status);
            const clickable = !forecast && Boolean(e.transactionId && e.portfolioId);
            const label = e.symbol ?? e.displayName ?? e.name ?? "—";
            const typeLabel = tt(e.type);
            const dateLabel = df.format(new Date(e.date));
            const amountLabel = formatMoney(Number(e.amount), e.currency, locale);
            const amountClass = forecast ? "text-text-2" : signToneClass(Number(e.amount));
            const shares =
              e.quantity != null
                ? Number(e.quantity).toLocaleString(locale, { maximumFractionDigits: 4 })
                : "—";
            const perShare =
              e.perShare != null ? formatMoney(Number(e.perShare), e.currency, locale) : "—";
            // Forecast growth/contribution assumptions no longer have a dedicated row —
            // surface them on hover so the number's basis stays discoverable.
            const title =
              [
                e.growthApplied !== undefined
                  ? t("growthHint", {
                      pct: `${e.growthApplied >= 1 ? "+" : ""}${((e.growthApplied - 1) * 100).toFixed(1)}%`,
                    })
                  : null,
                e.assumesContributions ? t("contributionsHint") : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined;

            const estTag = forecast && (
              <span className="shrink-0 rounded-xs bg-line px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide text-text-2">
                {t("est")}
              </span>
            );

            return (
              <Fragment key={`${e.instrumentId}-${e.date}-${i}`}>
                {showBand && (
                  <div className="bg-card-2 px-0.5 py-[9px] text-micro font-bold uppercase tracking-label text-text-2">
                    {monthFmt!.format(new Date(e.date))}
                    <span className="ml-2 font-normal normal-case">{monthTotals.get(mc)}</span>
                  </div>
                )}
                <div
                  title={title}
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
                    i > 0 && "border-t border-line",
                    clickable && "cursor-pointer transition-colors hover:bg-muted/40",
                    loadingId === e.transactionId && "opacity-60",
                  )}
                >
                  {/* Desktop: 6-column grid. */}
                  <div
                    className={cn(
                      "hidden items-center gap-3.5 px-0.5 py-[11px] sm:grid",
                      TIMELINE_GRID,
                    )}
                  >
                    <span className="tabular whitespace-nowrap text-xs font-semibold text-text-2">
                      {dateLabel}
                    </span>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <TimelineBadge label={label} type={e.type} forecast={forecast} />
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

                  {/* Mobile: flex row. */}
                  <div className="flex items-center gap-3 px-0.5 py-[11px] sm:hidden">
                    <TimelineBadge label={label} type={e.type} forecast={forecast} />
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

      <TransactionDetailSheet
        tx={detailTx}
        open={!!detailTx}
        onOpenChange={(o) => {
          if (!o) setDetailTx(null);
        }}
        onDeleted={() => {
          setDetailTx(null);
          router.refresh();
        }}
      />
    </div>
  );
}

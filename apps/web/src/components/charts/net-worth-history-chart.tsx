"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { LineChart } from "lucide-react";
import type { HistoryPoint, PerformancePoint } from "@portfolio/api-client";
import { isIntradayPoint } from "@portfolio/api-client";

/** Narrow a HistoryPoint down to the day-grained (`date`) shape. */
function isDailyPoint(p: HistoryPoint): p is PerformancePoint {
  return !isIntradayPoint(p);
}
import { PriceChart } from "@/components/charts/price-chart";
import { RangeToggle, type ChartRange } from "@/components/charts/range-toggle";
import { EmptyState } from "@/components/empty-state";
import { useApiClient } from "@/lib/api";
import { cn } from "@/lib/utils";

type ChartMode = "performance" | "value";

/** True for the timestamped (1D/7D) ranges, read from the intraday snapshot table. */
function isIntradayRange(range: ChartRange): boolean {
  return range === "1d" || range === "7d";
}

export function NetWorthHistoryChart({
  initial,
  currency,
  selectedId = null,
}: {
  initial: HistoryPoint[];
  currency: string;
  selectedId?: string | null;
}) {
  const te = useTranslations("Empty");
  const t = useTranslations("Chart");
  const locale = useLocale();
  const api = useApiClient();
  const [range, setRange] = useState<ChartRange>("1y");
  const [mode, setMode] = useState<ChartMode>("performance");
  const [data, setData] = useState<HistoryPoint[]>(initial);
  const [loading, setLoading] = useState(false);

  async function pick(r: ChartRange) {
    if (r === range) return;
    setRange(r);
    setLoading(true);
    try {
      setData(
        selectedId
          ? await api.getPortfolioHistory(selectedId, r)
          : await api.getNetWorthHistory(r),
      );
    } catch {
      // keep last good series on failed refetch
    } finally {
      setLoading(false);
    }
  }

  const intraday = isIntradayRange(range);
  // No TWR pct/index on intraday points — the Performance toggle only applies to
  // the day-grained ranges, so intraday always renders as a Value chart.
  const effectiveMode: ChartMode = intraday ? "value" : mode;

  const intradayLabelFmt = new Intl.DateTimeFormat(
    locale,
    range === "1d" ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" },
  );

  const chartData = intraday
    ? data.filter(isIntradayPoint).map((p) => ({
        date: intradayLabelFmt.format(new Date(p.at)),
        close: selectedId ? (p.marketValue ?? p.netWorth) : p.netWorth,
      }))
    : effectiveMode === "performance"
      ? data.filter(isDailyPoint).map((p) => ({ date: p.date, close: p.pct ?? "0" }))
      : selectedId
        ? data
            .filter(isDailyPoint)
            .map((p) => ({ date: p.date, close: p.marketValue ?? p.netWorth }))
        : data.filter(isDailyPoint).map((p) => ({ date: p.date, close: p.netWorth }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {/* Mode toggle */}
        <div
          className="flex rounded-md border border-border overflow-hidden text-xs"
          role="group"
          aria-label={t("modeLabel")}
        >
          {(["performance", "value"] as ChartMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              disabled={intraday && m === "performance"}
              aria-pressed={effectiveMode === m}
              className={cn(
                "px-3 py-1 font-medium transition-colors disabled:opacity-50",
                effectiveMode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t(m === "performance" ? "modePerformance" : "modeValue")}
            </button>
          ))}
        </div>
        <RangeToggle value={range} onChange={pick} disabled={loading} />
      </div>
      {intraday && data.length < 2 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t("collectingIntraday")}
        </p>
      ) : data.length > 1 ? (
        <PriceChart
          data={chartData}
          currency={currency}
          unit={effectiveMode === "performance" ? "percent" : "currency"}
        />
      ) : (
        <EmptyState
          icon={LineChart}
          title={te("historyTitle")}
          description={te("historyBody")}
        />
      )}
    </div>
  );
}

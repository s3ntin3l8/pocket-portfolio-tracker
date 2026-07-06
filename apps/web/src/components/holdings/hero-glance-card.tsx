"use client";

import { useState, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { HistoryPoint } from "@portfolio/api-client";
import {
  NetWorthHistoryChart,
  type ChartSeriesPoint,
} from "@/components/charts/net-worth-history-chart";
import type { ChartRange } from "@/components/charts/range-toggle";
import { formatMoney, formatPercent } from "@/lib/utils";

/**
 * The Holdings "glance" hero: a green gradient card with the current total portfolio
 * value (static — always today's figure), a delta/pct pill for the *currently selected*
 * chart period (derived from {@link NetWorthHistoryChart}'s own emitted series via
 * `onSeriesChange`, matching the design's period-scoped `heroDelta`/`heroPct`), and the
 * reused sparkline+hover-tooltip+range-toggle chart itself in its "hero" variant.
 */
export function HeroGlanceCard({
  netWorth,
  currency,
  initialHistory,
  initialRange,
  selectedId = null,
}: {
  netWorth: string;
  currency: string;
  initialHistory: HistoryPoint[];
  initialRange: ChartRange;
  selectedId?: string | null;
}) {
  const t = useTranslations("Holdings.hero");
  const tr = useTranslations("Chart.range");
  const locale = useLocale();
  const [series, setSeries] = useState<{ points: ChartSeriesPoint[]; range: ChartRange }>({
    points: [],
    range: initialRange,
  });

  const onSeriesChange = useCallback((points: ChartSeriesPoint[], range: ChartRange) => {
    setSeries({ points, range });
  }, []);

  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  const hasDelta = first !== undefined && last !== undefined && series.points.length > 1;
  const delta = hasDelta ? last.close - first.close : 0;
  const pct = hasDelta && first.close !== 0 ? delta / first.close : null;
  const periodWord =
    series.range === "all" ? t("periodAllTime") : t("periodPast", { range: tr(series.range) });

  return (
    <div
      className="rounded-[26px] px-6 pb-[18px] pt-[22px] text-white shadow-[0_12px_30px_rgba(14,159,110,.30)] sm:rounded-[20px]"
      style={{ background: "linear-gradient(160deg,#0E9F6E,#0B7D58)" }}
    >
      <p className="text-[13px] font-semibold text-white/78">{t("label")}</p>
      <p className="tabular mt-1 text-[34px] font-extrabold leading-tight sm:text-[36px]">
        {formatMoney(Number(netWorth), currency, locale)}
      </p>

      {hasDelta && (
        <div className="mt-2 flex items-center gap-2">
          <span className="tabular rounded-full bg-white/18 px-2.5 py-1 text-[13px] font-bold">
            {delta >= 0 ? "▲" : "▼"} {formatMoney(Math.abs(delta), currency, locale)}
          </span>
          {pct !== null && (
            <span className="tabular text-[13px] font-bold text-white/90">
              {formatPercent(pct, locale)} {periodWord}
            </span>
          )}
        </div>
      )}

      <div className="mt-3.5">
        <NetWorthHistoryChart
          initial={initialHistory}
          currency={currency}
          selectedId={selectedId}
          variant="hero"
          initialRange={initialRange}
          onSeriesChange={onSeriesChange}
        />
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { HistoryPoint } from "@portfolio/api-client";
import {
  NetWorthHistoryChart,
  type HeroSeriesSnapshot,
} from "@/components/charts/net-worth-history-chart";
import type { ChartRange } from "@/components/charts/range-toggle";
import { benchmarkLabel } from "@/lib/benchmark-labels";
import { formatMoney, formatPercent } from "@/lib/utils";

/**
 * The Holdings "glance" hero: green gradient card with the current total portfolio
 * value (static — always today's figure), two period pills (portfolio TWR % and the
 * user's chosen benchmark's period %), a tiny legend, and the chart itself in its
 * "hero" variant. The pill values are derived from {@link NetWorthHistoryChart}'s
 * emitted TWR-normalized series (via `onSeriesChange`) — the chart strips out
 * baseline cash flows so a deposit doesn't manufacture phantom gains in the period
 * comparison.
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
  const tb = useTranslations("Insights.benchmark");
  const locale = useLocale();
  const [snapshot, setSnapshot] = useState<HeroSeriesSnapshot>({
    points: [],
    benchmarkPct: null,
    hasBenchmark: false,
  });
  const [range, setRange] = useState<ChartRange>(initialRange);

  const onSeriesChange = useCallback((s: HeroSeriesSnapshot, r: ChartRange) => {
    setSnapshot(s);
    setRange(r);
  }, []);

  const first = snapshot.points[0];
  const last = snapshot.points[snapshot.points.length - 1];
  const hasDelta = first !== undefined && last !== undefined && snapshot.points.length > 1;
  // The chart emits `pct` (TWR %, chain-indexed, already ×100) as `close` on the
  // hero series. The period delta is the difference between the first and last
  // point's `close` (e.g. 0 → 5.4 means +5.4 pp of TWR). Divide by 100 before
  // `formatPercent` (which multiplies back by 100 internally).
  const portfolioPct = hasDelta ? Number(last.close) - Number(first.close) : null;
  const benchmarkPct = snapshot.benchmarkPct !== null ? Number(snapshot.benchmarkPct) : null;
  const periodWord = range === "all" ? t("periodAllTime") : t("periodPast", { range: tr(range) });
  // The hero card doesn't need to know the user's exact configured symbol to render
  // the label correctly — `benchmarkLabel("^GSPC")` is the default and the
  // user-facing symbol picker is already on the Insights page. If the user changes
  // their benchmark, both the chart and the label update on the next render via
  // `router.refresh()` from the existing `EditBenchmarkDialog` flow.
  const benchmarkSymbol = "^GSPC";

  return (
    <div
      className="rounded-[26px] px-6 pb-[18px] pt-[22px] text-white shadow-[0_12px_30px_rgba(14,159,110,.30)] sm:rounded-[20px]"
      style={{ background: "linear-gradient(160deg,#0E9F6E,#0B7D58)" }}
    >
      <p className="text-[13px] font-semibold text-white/78">{t("label")}</p>
      <p className="tabular mt-1 text-[34px] font-extrabold leading-tight sm:text-[36px]">
        {formatMoney(Number(netWorth), currency, locale)}
      </p>

      {hasDelta && portfolioPct !== null && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="tabular rounded-full bg-white/18 px-2.5 py-1 text-[13px] font-bold">
            {portfolioPct >= 0 ? "▲" : "▼"} {formatPercent(portfolioPct / 100, locale)} {periodWord}
          </span>
          <span className="tabular rounded-full bg-white/18 px-2.5 py-1 text-[13px] font-bold">
            {tb("vs", { symbol: benchmarkLabel(benchmarkSymbol) })}{" "}
            {benchmarkPct !== null
              ? formatPercent(benchmarkPct / 100, locale)
              : t("benchmarkPillUnavailable")}
          </span>
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

      {hasDelta && (
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] font-semibold text-white/78">
          <span>
            <span
              className="mr-1 inline-block h-[2px] w-3 align-middle"
              style={{ background: "#ffffff" }}
            />
            {t("legendPortfolio")}
          </span>
          {snapshot.hasBenchmark && (
            <span>
              <span
                className="mr-1 inline-block align-middle"
                style={{
                  borderTop: "2px dashed #FFD24A",
                  background: "transparent",
                  width: 12,
                  height: 0,
                }}
              />
              {t("legendBenchmark", { symbol: benchmarkLabel(benchmarkSymbol) })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

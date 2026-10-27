"use client";

import { CHART_AXIS_TICK, CHART_SERIES_DASH } from "@/lib/chart-style";
import { signToneClass, toneOf } from "@/lib/tone";
import { useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { PiggyBank, Info } from "lucide-react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  useActiveTooltipDataPoints,
  useActiveTooltipLabel,
  useIsTooltipActive,
} from "recharts";
import type { PerformancePoint } from "@portfolio/api-client";
import { LazyPriceChart as PriceChart } from "@/components/charts/lazy";
import { EmptyState } from "@/components/empty-state";
import { mergeContributionValue } from "@/lib/chart-series";
import { formatMoney, formatMoneyCompact } from "@/lib/utils";
import { ChartTooltipPanel } from "@/components/ui/chart-tooltip-panel";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * Contributions vs. portfolio value overlay chart.
 *
 * When `valueHistory` has ≥ 2 points the chart renders both series on a daily
 * x-axis: a shaded gain/loss band between contributions and value, with crisp
 * boundary lines on top.  When history is absent it degrades to the legacy
 * single-series cumulative-contributions area chart.
 */
export function ContributionsChart({
  series,
  dailySeries,
  valueHistory,
  currency,
}: {
  series: { month: string; contributed: string }[];
  dailySeries: { date: string; contributed: string }[];
  valueHistory: PerformancePoint[];
  currency: string;
}) {
  const reducedMotion = useReducedMotion();
  const t = useTranslations("Savings");
  const tA11y = useTranslations("A11y");
  const te = useTranslations("Empty");
  const locale = useLocale();

  // Attempt the full overlay merge. Uses the day-resolution series so the contributed
  // step lands on the actual transaction day, aligned with the daily value line.
  const merged = useMemo(
    () => mergeContributionValue(dailySeries, valueHistory),
    [dailySeries, valueHistory],
  );

  // Derive per-point band fields for the overlay path.
  // At every x exactly one of gain/loss is non-zero, so stacking
  // floor + gain + loss places the filled area correctly.
  const overlayData = useMemo(
    () =>
      merged.map((p) => {
        const floor = Math.min(p.value, p.contributed);
        return {
          date: p.date,
          contributed: p.contributed,
          value: p.value,
          floor,
          gain: Math.max(0, p.value - p.contributed),
          loss: Math.max(0, p.contributed - p.value),
        };
      }),
    [merged],
  );

  // Running total as a prefix sum for the degraded path.
  const degradedPoints = useMemo(() => {
    return series.reduce<{ date: string; close: string }[]>((acc, s) => {
      const prev = acc.length > 0 ? Number(acc[acc.length - 1]!.close) : 0;
      acc.push({ date: s.month, close: (prev + Number(s.contributed)).toString() });
      return acc;
    }, []);
  }, [series]);

  const isOverlay = overlayData.length >= 2;

  // Days where a portfolio had no snapshot and its last net worth was carried forward in the
  // aggregate series (#1172); the value line plots net worth, so say so.
  const carriedDays = valueHistory.filter((p) => p.netWorthCarried === true).length;

  const money = (v: number) => formatMoney(v, currency, locale);

  // ── OVERLAY PATH ─────────────────────────────────────────────────────────
  if (isOverlay) {
    const lastPoint = overlayData[overlayData.length - 1];
    const invested = lastPoint.contributed;
    const nowWorth = lastPoint.value;
    const gain = nowWorth - invested;
    // The value line carries the sign it is supposed to encode: an underwater portfolio's
    // value line is red, not the hard-coded green the reference sample happened to show.
    const valueTone = toneOf(gain);
    const valueStroke =
      valueTone === "up"
        ? "var(--color-success)"
        : valueTone === "down"
          ? "var(--color-destructive)"
          : "var(--color-muted-foreground)";

    return (
      <div className="space-y-3">
        {/* Legend lives in the card header (right of the title) — see the Savings page. */}
        <div className="h-[200px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={overlayData}
              margin={{ top: 8, right: 8, left: 8, bottom: 0 }}
              title={tA11y("chartContributionsTitle")}
              desc={tA11y("chartContributionsDesc", { count: overlayData.length })}
              role="img"
            >
              <defs>
                {/* Transparent base so the band starts at the lower of the two lines */}
                <linearGradient id="cv-floor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="transparent" stopOpacity={0} />
                </linearGradient>
                {/* Green fill: value > contributions (the reference's default look) */}
                <linearGradient id="cv-gain" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                </linearGradient>
                {/* Red fill: value < contributions — real signal (currently underwater),
                    kept but toned down; the reference sample data never dips below cost. */}
                <linearGradient id="cv-loss" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-destructive)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--color-destructive)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={CHART_AXIS_TICK}
                tickLine={false}
                axisLine={false}
                minTickGap={48}
              />
              {/* Value axis: the scale and its unit were previously only readable from the
                  tooltip. The ticks carry the money format (so the currency is on every
                  tick) and the axis label names the currency outright. */}
              <YAxis
                tick={CHART_AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width="auto"
                tickFormatter={(v: number) => formatMoneyCompact(v, currency, locale)}
                label={currency}
              />
              <Tooltip content={<OverlayTooltip money={money} t={t} />} />

              {/* Transparent base Area — establishes the lower boundary of the band */}
              <Area
                isAnimationActive={!reducedMotion}
                type="monotone"
                dataKey="floor"
                stackId="band"
                stroke="none"
                fill="url(#cv-floor)"
                legendType="none"
                tooltipType="none"
              />
              {/* Green gain band */}
              <Area
                isAnimationActive={!reducedMotion}
                type="monotone"
                dataKey="gain"
                stackId="band"
                stroke="none"
                fill="url(#cv-gain)"
                legendType="none"
                tooltipType="none"
              />
              {/* Red loss band */}
              <Area
                isAnimationActive={!reducedMotion}
                type="monotone"
                dataKey="loss"
                stackId="band"
                stroke="none"
                fill="url(#cv-loss)"
                legendType="none"
                tooltipType="none"
              />

              {/* Crisp boundary: contributions step line */}
              <Line
                isAnimationActive={!reducedMotion}
                type="stepAfter"
                dataKey="contributed"
                stroke="var(--color-muted-foreground)"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray={CHART_SERIES_DASH}
              />
              {/* Crisp boundary: daily value line — toned by the sign of the gain. */}
              <Line
                isAnimationActive={!reducedMotion}
                type="monotone"
                dataKey="value"
                stroke={valueStroke}
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {carriedDays > 0 && (
          <p className="text-micro font-medium text-text-mute">
            {t("carriedNote", { count: carriedDays })}
          </p>
        )}

        {/* Invested / Gain / Now worth footer — reference shows this row under the chart.
            Even 3-col spread on mobile (a fixed gap-6 flex row left-clusters into ~80% of
            the width on a phone); back to the reference's flex row once there's room. */}
        <div className="grid grid-cols-3 gap-4 border-t border-border pt-3 sm:flex sm:items-center sm:gap-6">
          <div>
            <p className="text-xs text-muted-foreground">{t("footerInvested")}</p>
            <p className="tabular mt-0.5 text-sm font-bold">{money(invested)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("footerGain")}</p>
            <p className={`tabular mt-0.5 text-sm font-bold ${signToneClass(gain)}`}>
              {gain > 0 ? "+" : ""}
              {money(gain)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t("footerNowWorth")}</p>
            <p className="tabular mt-0.5 text-sm font-bold">{money(nowWorth)}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── DEGRADED PATH ─────────────────────────────────────────────────────────
  // No value history — fall back to the legacy single-series chart plus an
  // info note so the user knows why the overlay is missing.

  if (degradedPoints.length < 2) {
    return (
      <EmptyState icon={PiggyBank} title={te("historyTitle")} description={te("historyBody")} />
    );
  }

  return (
    <div className="space-y-2">
      <PriceChart
        data={degradedPoints}
        currency={currency}
        title={tA11y("chartContributionsTitle")}
        desc={tA11y("chartContributionsDesc", { count: degradedPoints.length })}
      />
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0" />
        {t("chartValueUnavailable")}
      </p>
    </div>
  );
}

/**
 * Custom tooltip rendered inside the recharts context.
 * Uses recharts v3 hooks to read the hovered point, showing Contributions and
 * Value while hiding the internal band keys (floor/gain/loss).
 */
function OverlayTooltip({
  money,
  t,
}: {
  money: (v: number) => string;
  t: ReturnType<typeof useTranslations<"Savings">>;
}) {
  const active = useIsTooltipActive();
  const label = useActiveTooltipLabel();
  // Each entry is one raw data row from the chart's `data` array.
  const points = useActiveTooltipDataPoints<{
    date: string;
    contributed: number;
    value: number;
    floor: number;
    gain: number;
    loss: number;
  }>();

  if (!active || !points?.length) return null;

  const p = points[0];

  return (
    <ChartTooltipPanel
      title={label == null ? undefined : String(label)}
      rows={[
        {
          label: t("chartContributions"),
          value: money(p.contributed),
        },
        {
          label: t("chartValue"),
          value: money(p.value),
          dot: "var(--color-primary)",
        },
      ]}
    />
  );
}

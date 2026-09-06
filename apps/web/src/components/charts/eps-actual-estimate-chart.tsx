"use client";

import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useTranslations } from "next-intl";
import { ChartTooltipPanel, type ChartTooltipRow } from "@/components/ui/chart-tooltip-panel";

export interface EpsQuarter {
  /** Yahoo's calendar-quarter label, e.g. "1Q2025". */
  period: string;
  /** Reported EPS for the quarter. Null when Yahoo omitted the value. */
  actual: number | null;
  /** Pre-report consensus EPS estimate. Null when no consensus was available. */
  estimate: number | null;
}

/** Internal chart row — a reported quarter plus the synthetic forecast row appended at the
 *  end when `currentQuarterEstimate` is provided. The `forecast` flag drives the dashed /
 *  translucent visual treatment in the estimate `<Bar>`. */
interface EpsChartRow extends EpsQuarter {
  forecast?: boolean;
}

/** Estimate / Actual key, rendered inline with the section title (2 series → a legend
 *  is always present, per the app's chart conventions). */
export function EpsActualEstimateChartLegend() {
  const t = useTranslations("Instrument");
  return (
    <div className="ml-auto flex shrink-0 items-center gap-3.5 text-[11px] font-semibold text-text-2">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-[var(--color-chart-1)]" />
        {t("epsEstimateLabel")}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-[var(--color-chart-2)]" />
        {t("epsActualLabel")}
      </span>
    </div>
  );
}

/**
 * Per-quarter hover breakdown (estimate vs. actual + surprise), exported for direct unit
 * testing — `recharts`' `Tooltip` only invokes `content` at real layout time, which jsdom
 * stubs don't simulate (same rationale as `RevenueEarningsChart`'s tooltip).
 */
export function ChartTooltip({
  active,
  payload,
  label,
  t,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; payload: EpsQuarter }>;
  label?: string;
  t: (key: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const bar = payload[0]?.payload;
  if (!bar) return null;

  const formatEps = (v: number | null) => (v == null ? "—" : v.toFixed(2));
  const surprise = bar.actual != null && bar.estimate != null ? bar.actual - bar.estimate : 0;

  const rows: ChartTooltipRow[] = [
    ...(bar.estimate != null
      ? [
          {
            label: t("epsEstimateLabel"),
            value: formatEps(bar.estimate),
            dot: "var(--color-chart-1)",
          },
        ]
      : []),
    {
      label: t("epsActualLabel"),
      value: formatEps(bar.actual),
      dot: "var(--color-chart-2)",
    },
    {
      label: t("epsSurpriseLabel"),
      value: `${surprise >= 0 ? "+" : ""}${surprise.toFixed(2)}`,
    },
  ];

  return <ChartTooltipPanel title={String(label)} rows={rows} />;
}

/**
 * Trailing quarterly EPS as a grouped bar chart — analyst estimate vs. reported actual
 * (chart-1/chart-2, the app's fixed hue order), oldest quarter first. When
 * `currentQuarterEstimate` is provided, a synthetic trailing row is appended with the
 * `forecast` flag set so its estimate bar renders as a dashed/translucent sentinel
 * (mirrors `IncomeBarChart`'s forecast bar treatment, see income-bar-chart.tsx). Actual
 * is null on the forecast row so only the estimate side draws.
 *
 * EPS is per-share (dimensionless), so the Y axis is unlabeled — `formatMoneyCompact`
 * would add a misleading currency prefix. Tooltip rows carry plain `toFixed(2)` values.
 */
export function EpsActualEstimateChart({
  data,
  currentQuarterEstimate,
}: {
  data: EpsQuarter[];
  currentQuarterEstimate: number | null;
}) {
  const t = useTranslations("Instrument");
  const rows: EpsChartRow[] = [...data];
  if (currentQuarterEstimate != null) {
    rows.push({
      period: t("epsCurrentQuarterLabel"),
      actual: null,
      estimate: currentQuarterEstimate,
      forecast: true,
    });
  }

  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="period"
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={8}
          />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "var(--color-muted)", opacity: 0.3 }}
            content={<ChartTooltip t={t} />}
          />
          <Bar dataKey="estimate" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]}>
            {rows.map((r, i) =>
              r.forecast ? (
                <Cell
                  key={i}
                  fill="var(--color-chart-1)"
                  fillOpacity={0.12}
                  stroke="var(--color-chart-1)"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                />
              ) : undefined,
            )}
          </Bar>
          <Bar dataKey="actual" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

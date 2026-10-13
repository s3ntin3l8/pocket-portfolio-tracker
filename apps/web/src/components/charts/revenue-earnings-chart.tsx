"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useLocale, useTranslations } from "next-intl";
import { formatMoneyCompact } from "@/lib/utils";
import { ChartTooltipPanel, type ChartTooltipRow } from "@/components/ui/chart-tooltip-panel";
import { useReducedMotion } from "@/lib/use-reduced-motion";

export interface RevenueEarningsYear {
  year: number;
  revenue: number;
  earnings: number;
}

export { RevenueEarningsChartLegend } from "./revenue-earnings-legend";

/**
 * Per-year hover breakdown (revenue vs. earnings), exported for direct unit-testing —
 * `recharts`' `Tooltip` only invokes `content` at real layout time, which jsdom test
 * stubs don't simulate (same rationale as `IncomeBarChart`'s `ChartTooltip`).
 */
export function ChartTooltip({
  active,
  payload,
  label,
  money,
  t,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; payload: RevenueEarningsYear }>;
  label?: number;
  money: (v: number) => string;
  t: (key: string) => string;
}) {
  if (!active || !payload?.length) return null;
  const bar = payload[0]?.payload;
  if (!bar) return null;

  const rows: ChartTooltipRow[] = [
    { label: t("revenueLabel"), value: money(bar.revenue), dot: "var(--color-chart-1)" },
    { label: t("earningsLabel"), value: money(bar.earnings), dot: "var(--color-chart-2)" },
  ];

  return <ChartTooltipPanel title={String(label)} rows={rows} />;
}

/**
 * Trailing annual revenue vs. earnings as a grouped bar chart — two categorical series
 * (assigned `chart-1`/`chart-2` in the app's fixed hue order), oldest year first. Small
 * multiple of {@link IncomeBarChart}'s conventions but grouped (not stacked): revenue and
 * earnings are different measures, so stacking them would sum unrelated quantities.
 */
export function RevenueEarningsChart({
  data,
  currency,
}: {
  data: RevenueEarningsYear[];
  currency: string;
}) {
  const reducedMotion = useReducedMotion();
  const locale = useLocale();
  const t = useTranslations("Instrument");
  const money = (v: number) => formatMoneyCompact(v, currency, locale);

  return (
    <div className="h-[180px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="year"
            tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            minTickGap={8}
          />
          <YAxis hide />
          <Tooltip
            cursor={{ fill: "var(--color-muted)", opacity: 0.3 }}
            content={<ChartTooltip money={money} t={t} />}
          />
          <Bar
            isAnimationActive={!reducedMotion}
            dataKey="revenue"
            fill="var(--color-chart-1)"
            radius={[4, 4, 0, 0]}
          />
          <Bar
            isAnimationActive={!reducedMotion}
            dataKey="earnings"
            fill="var(--color-chart-2)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

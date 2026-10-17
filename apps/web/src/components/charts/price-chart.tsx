"use client";

import { CHART_AXIS_TICK, CHART_CURSOR, CHART_GRID } from "@/lib/chart-style";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";
import { useLocale } from "next-intl";
import type { Candle } from "@portfolio/api-client";
import { formatMoney } from "@/lib/utils";
import { ChartTooltipPanel } from "@/components/ui/chart-tooltip-panel";
import { useReducedMotion } from "@/lib/use-reduced-motion";

export function PriceChart({
  data,
  currency,
  unit = "currency",
  minimal = false,
  showYAxis = true,
  height = 280,
}: {
  data: Candle[];
  currency: string;
  unit?: "currency" | "percent";
  /** Hide axes/grid — just the area+line, for a compact sparkline (e.g. the Holdings hero). */
  minimal?: boolean;
  /** Show Y-axis on the left. Disable on narrow viewports — the tooltip cursor already shows the price. */
  showYAxis?: boolean;
  height?: number;
}) {
  const reducedMotion = useReducedMotion();
  const locale = useLocale();
  const points = data.map((d) => ({ date: d.date, close: Number(d.close) }));
  const gradientId = "price-fill";
  const lineColor = "var(--color-primary)";

  const formatValue = (v: number) =>
    unit === "percent" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : formatMoney(v, currency, locale);

  const dateLabelFmt = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  // The tooltip's label defaults to recharts' x category — which, in `minimal` mode
  // (no <XAxis>), is the row *index* (e.g. "364" on a 1Y daily series). Pull the real
  // `date` off the hovered point's payload instead. Day-grained points carry a raw
  // ISO date (YYYY-MM-DD) → format it; intraday points already carry a display label
  // (e.g. "14:30", "3 Jul") → pass it through untouched.
  const formatLabel = (
    _label: unknown,
    payload: ReadonlyArray<{ payload?: { date?: string } }> | undefined,
  ) => {
    const d = payload?.[0]?.payload?.date;
    if (!d) return "";
    return /^\d{4}-\d{2}-\d{2}/.test(d) ? dateLabelFmt.format(new Date(d)) : d;
  };

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height }}>
        <AreaChart
          data={points}
          margin={
            minimal
              ? { top: 4, right: 0, left: 0, bottom: 0 }
              : { top: 8, right: 8, left: 0, bottom: 0 }
          }
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.35} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          {!minimal && (
            <>
              <CartesianGrid {...CHART_GRID} />
              <XAxis dataKey="date" tick={CHART_AXIS_TICK} tickLine={false} minTickGap={32} />
              {showYAxis && (
                <YAxis
                  tick={CHART_AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width="auto"
                  tickFormatter={formatValue}
                />
              )}
            </>
          )}
          <Tooltip
            cursor={CHART_CURSOR}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const v = Number(payload[0]?.value);
              if (!Number.isFinite(v)) return null;
              return (
                <ChartTooltipPanel
                  rows={[{ label: formatLabel(label, payload), value: formatValue(v) }]}
                />
              );
            }}
          />
          <Area
            isAnimationActive={!reducedMotion}
            type="monotone"
            dataKey="close"
            stroke={lineColor}
            strokeWidth={2.4}
            fill={`url(#${gradientId})`}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

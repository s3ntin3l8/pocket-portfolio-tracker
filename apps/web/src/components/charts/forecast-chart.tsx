"use client";

import { AreaChart, Area, Line, Tooltip, ResponsiveContainer } from "recharts";
import { useLocale, useTranslations } from "next-intl";
import type { ForecastPoint } from "@portfolio/core";
import { formatMoney } from "@/lib/utils";
import { ChartTooltipPanel } from "@/components/ui/chart-tooltip-panel";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * Forecast sparkline for the Savings forecast card: a solid brand-green **value** line
 * (present value + contributions + growth) with a soft fill, and a dashed muted
 * **contributed** line underneath it (what you'd have put in with no growth at all) — no
 * axes/grid, matching the Holdings hero's minimal sparkline convention.
 */
export function ForecastChart({
  series,
  presentValue,
  currency,
}: {
  series: ForecastPoint[];
  presentValue: string;
  currency: string;
}) {
  const reducedMotion = useReducedMotion();
  const locale = useLocale();
  const t = useTranslations("Savings");
  const pv = Number(presentValue);

  const data = series.map((p) => ({
    month: p.monthIndex,
    value: Number(p.value),
    contributed: pv + Number(p.contributed),
  }));

  const money = (v: number) => formatMoney(v, currency, locale);

  return (
    <div className="h-[160px] w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 160 }}>
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="forecast-value-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            cursor={{
              stroke: "color-mix(in srgb, var(--muted-foreground) 55%, transparent)",
              strokeDasharray: "4 4",
            }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <ChartTooltipPanel
                  title={t("years", { count: Math.round(Number(label) / 12) })}
                  rows={payload.map((p) => ({
                    label:
                      p.dataKey === "contributed" ? t("projectedContributed") : t("projectedValue"),
                    value: money(Number(p.value)),
                  }))}
                />
              );
            }}
          />
          <Area
            isAnimationActive={!reducedMotion}
            type="monotone"
            dataKey="value"
            stroke="var(--primary)"
            strokeWidth={2.4}
            fill="url(#forecast-value-fill)"
            activeDot={{
              r: 5,
              fill: "var(--primary)",
              stroke: "var(--card)",
              strokeWidth: 2.5,
            }}
          />
          <Line
            isAnimationActive={!reducedMotion}
            type="monotone"
            dataKey="contributed"
            stroke="var(--muted-foreground)"
            strokeWidth={1.6}
            strokeDasharray="4 4"
            dot={false}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

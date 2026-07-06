"use client";

import { AreaChart, Area, Line, Tooltip, ResponsiveContainer } from "recharts";
import { useLocale, useTranslations } from "next-intl";
import type { ForecastPoint } from "@portfolio/core";
import { formatMoney } from "@/lib/utils";

/**
 * Forecast sparkline for the green-gradient forecast hero: a solid white **value**
 * line (present value + contributions + growth) with a soft white fill, and a dashed
 * white **contributed** line underneath it (what you'd have put in with no growth at
 * all) — mirrors the reference's white-on-green treatment, no axes/grid (matches the
 * Holdings hero's "minimal" sparkline convention).
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
              <stop offset="0%" stopColor="#ffffff" stopOpacity={0.42} />
              <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            formatter={(v, key) => [
              money(Number(v)),
              key === "contributed" ? t("projectedContributed") : t("projectedValue"),
            ]}
            labelFormatter={(m) => t("years", { count: Math.round(Number(m) / 12) })}
            cursor={{ stroke: "rgba(255,255,255,.55)", strokeDasharray: "4 4" }}
            contentStyle={{
              background: "#0f1b14",
              border: "none",
              borderRadius: 10,
              color: "#fff",
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#ffffff"
            strokeWidth={2.4}
            fill="url(#forecast-value-fill)"
            activeDot={{ r: 5, fill: "#fff", stroke: "#0B7D58", strokeWidth: 2.5 }}
          />
          <Line
            type="monotone"
            dataKey="contributed"
            stroke="rgba(255,255,255,.65)"
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

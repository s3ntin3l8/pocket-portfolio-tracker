"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useLocale } from "next-intl";
import { formatMoney } from "@/lib/utils";

/** A single donut slice — any keyed category (asset class, currency, …). */
export interface DonutSlice {
  key: string;
  label: string;
  value: number;
}

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

export function AllocationDonut({
  data,
  currency = "IDR",
  total,
  label = "Total",
  onSliceClick,
  showPercent = true,
}: {
  data: DonutSlice[];
  currency?: string;
  total?: number;
  label?: string;
  onSliceClick?: (key: string) => void;
  /** Whether the legend shows a trailing "%" column — the Holdings allocation card
   *  does, Income's "By source" card doesn't (value only). Default true. */
  showPercent?: boolean;
}) {
  const locale = useLocale();
  const sum = data.reduce((s, d) => s + d.value, 0);
  const displayTotal = total ?? sum;
  const compact = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: currency === "IDR" ? 0 : 1,
    }).format(n);
  const formattedTotal = displayTotal > 0 ? compact(displayTotal) : null;

  return (
    // Reference (Holdings/Income) always shows the donut and its legend side by side —
    // a single vertical legend list to the donut's right, not stacked below it.
    <div className="flex items-center gap-6">
      <div className="relative h-[140px] w-[140px] shrink-0">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 140, height: 140 }}
        >
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={44}
              outerRadius={64}
              paddingAngle={2}
              strokeWidth={0}
              onClick={(entry) => onSliceClick?.(entry.payload.key)}
              style={{ cursor: onSliceClick ? "pointer" : undefined }}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatMoney(Number(value), currency, locale)}
              wrapperStyle={{ zIndex: 50 }}
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                color: "var(--color-popover-foreground)",
                fontSize: 12,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        {formattedTotal && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-2">
            <span className="max-w-[90px] text-center text-[10px] leading-tight font-medium tracking-wider text-muted-foreground uppercase">
              {label}
            </span>
            <span className="tabular text-center text-sm font-bold">
              {formattedTotal}
            </span>
          </div>
        )}
      </div>
      <ul className="min-w-0 flex-1 space-y-2 text-sm">
        {data.map((d, i) => (
          <li key={d.key} className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onSliceClick?.(d.key)}
              className={`flex min-w-0 flex-1 items-center gap-2 ${onSliceClick ? "cursor-pointer hover:underline" : "cursor-default"}`}
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <span className="truncate">{d.label}</span>
            </button>
            <span className="tabular shrink-0 text-right">{compact(d.value)}</span>
            {showPercent && (
              <span className="tabular w-12 shrink-0 text-right text-muted-foreground">
                {((d.value / sum) * 100).toFixed(1)}%
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

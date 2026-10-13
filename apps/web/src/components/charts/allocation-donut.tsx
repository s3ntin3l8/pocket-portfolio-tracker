"use client";

import { useId } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useLocale } from "next-intl";
import { formatMoney, formatPercentPoints } from "@/lib/utils";
import { ASSET_CLASS_COLOR_PALETTE, assetClassColor } from "@/lib/asset-class-colors";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/** A single donut slice — any keyed category (asset class, currency, …). */
export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  /** Part of `value` that is valued at cost basis (no market price). Drawn hatched so the
   *  at-cost share reads as "not a market value" (audit G3). Clamped to `[0, value]`. */
  atCostValue?: number;
  /** The server's share of the whole for this slice (percent points). When given the legend
   *  shows this instead of re-deriving `value / sum`, so every surface that renders the same
   *  allocation (Holdings donut, Insights Composition + Rebalancing) prints the same number. */
  actualPct?: number;
}

export function AllocationDonut({
  data,
  currency = "IDR",
  total,
  label = "Total",
  onSliceClick,
  showPercent = true,
  atCostLegend,
  atCostLabel,
}: {
  data: DonutSlice[];
  currency?: string;
  total?: number;
  label?: string;
  onSliceClick?: (key: string) => void;
  /** Whether the legend shows a trailing "%" column — the Holdings allocation card
   *  does, Income's "By source" card doesn't (value only). Default true. */
  showPercent?: boolean;
  /** Legend note shown when any slice has an `atCostValue` (e.g. "Hatched: valued at cost"). */
  atCostLegend?: string;
  /** Tooltip suffix for the hatched part of a slice (e.g. "At cost"). */
  atCostLabel?: string;
}) {
  const hatchId = useId().replace(/:/g, "");
  const reducedMotion = useReducedMotion();
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

  // Split each slice into its market-priced part and its at-cost part; the latter gets a
  // hatched fill. Sums are unchanged, so the ring still totals exactly the slice values.
  const colorOf = (key: string, i: number) =>
    assetClassColor(key, ASSET_CLASS_COLOR_PALETTE[i % ASSET_CLASS_COLOR_PALETTE.length]);
  const pieData = data.flatMap((d, i) => {
    const atCost = Math.min(Math.max(d.atCostValue ?? 0, 0), d.value);
    const out: {
      key: string;
      baseKey: string;
      label: string;
      value: number;
      hatchIdx: number | null;
      fill: string;
    }[] = [];
    if (d.value - atCost > 0 || atCost === 0) {
      out.push({
        key: d.key,
        baseKey: d.key,
        label: d.label,
        value: d.value - atCost,
        hatchIdx: null,
        fill: colorOf(d.key, i),
      });
    }
    if (atCost > 0) {
      out.push({
        key: `${d.key}:at-cost`,
        baseKey: d.key,
        label: atCostLabel ? `${d.label} · ${atCostLabel}` : d.label,
        value: atCost,
        hatchIdx: i,
        fill: `url(#${hatchId}-${i})`,
      });
    }
    return out;
  });
  const hasAtCost = pieData.some((p) => p.hatchIdx !== null);

  // Transcribed from `Pocket Prototype.dc.html` (desktop Holdings allocation card):
  // 128px donut (r54/13 stroke on a 120 viewBox → inner ≈50/outer ≈64 at 128px),
  // center "Assets" 600 10px + total 800 15px; legend rows gap-10px, 10×10 3px-radius
  // square swatch, label 600 12px, value 600 11px, pct 700 12px in a 50px column.
  return (
    // `@container`: this card can live in a fixed-width sidebar (Holdings' 320px rail,
    // Income's allocation card) as well as a wide main column (Insights' composition
    // card) — @sm keeps the row layout everywhere the ~321px it needs is available, and
    // stacks the donut above the legend when it isn't, instead of letting the legend's
    // value/percent columns overflow the card edge.
    <div className="@container flex flex-col gap-4 @sm:flex-row @sm:items-center @sm:gap-7">
      <div className="relative mx-auto h-32 w-32 shrink-0 @sm:mx-0">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 128, height: 128 }}
        >
          <PieChart>
            {hasAtCost && (
              <defs>
                {data.map((d, i) =>
                  pieData.some((p) => p.hatchIdx === i) ? (
                    <pattern
                      key={d.key}
                      id={`${hatchId}-${i}`}
                      width="6"
                      height="6"
                      patternUnits="userSpaceOnUse"
                      patternTransform="rotate(45)"
                    >
                      <rect width="6" height="6" fill={colorOf(d.key, i)} />
                      <rect
                        width="2.5"
                        height="6"
                        style={{ fill: "var(--color-card)" }}
                        fillOpacity="0.55"
                      />
                    </pattern>
                  ) : null,
                )}
              </defs>
            )}
            <Pie
              isAnimationActive={!reducedMotion}
              data={pieData}
              dataKey="value"
              nameKey="label"
              innerRadius={50}
              outerRadius={64}
              paddingAngle={0}
              strokeWidth={0}
              onClick={(entry) => onSliceClick?.(entry.payload.baseKey)}
              style={{ cursor: onSliceClick ? "pointer" : undefined }}
            >
              {pieData.map((slice) => (
                <Cell key={slice.key} fill={slice.fill} />
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
            <span className="text-center text-[10px] font-semibold text-text-3">{label}</span>
            <span className="tabular mt-0.5 text-center text-[15px] font-extrabold">
              {formattedTotal}
            </span>
          </div>
        )}
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-2.5">
        {data.map((d, i) => (
          <li key={d.key} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onSliceClick?.(d.key)}
              className={`flex min-w-0 flex-1 items-center gap-2 ${onSliceClick ? "cursor-pointer hover:underline" : "cursor-default"}`}
            >
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ background: colorOf(d.key, i) }}
              />
              <span className="truncate text-xs font-semibold">{d.label}</span>
            </button>
            <span className="tabular shrink-0 text-right text-[11px] font-semibold text-text-2">
              {compact(d.value)}
            </span>
            {showPercent && (
              <span className="tabular w-[50px] shrink-0 text-right text-xs font-bold">
                {formatPercentPoints(d.actualPct ?? (d.value / sum) * 100, locale, 1)}
              </span>
            )}
          </li>
        ))}
        {hasAtCost && atCostLegend && (
          <li className="flex items-center gap-2 text-[11px] font-medium text-text-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px] border border-text-3"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(45deg, var(--color-text-3) 0 2px, transparent 2px 4px)",
              }}
            />
            {atCostLegend}
          </li>
        )}
      </ul>
    </div>
  );
}

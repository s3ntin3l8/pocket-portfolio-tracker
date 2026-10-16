"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/**
 * Snapshot-history ranges. `1d`/`7d` read the timestamped intraday table (see
 * net-worth-history-chart.tsx); the rest are understood by the API's `rangeStart`
 * (+ `all` → full) against the day-grained daily-snapshot table.
 */
export const RANGES = ["1d", "7d", "1m", "3m", "ytd", "1y", "all"] as const;
export type ChartRange = (typeof RANGES)[number];

export function RangeToggle({
  value,
  onChange,
  disabled,
  ranges = RANGES,
}: {
  value: ChartRange;
  onChange: (range: ChartRange) => void;
  disabled?: boolean;
  /** Subset of ranges to render as chips (e.g. the hero card only shows 1D/7D/1M/1Y/ALL). */
  ranges?: readonly ChartRange[];
}) {
  const t = useTranslations("Chart.range");
  // Compact chips; the active one gets the card surface and a hairline lift.
  return (
    <ToggleGroup
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      aria-label={t("label")}
      className="gap-0.5"
    >
      {ranges.map((r) => (
        <ToggleGroupItem
          key={r}
          value={r}
          className={cn(
            "touch-target relative rounded-md px-3 py-1.5 text-micro",
            value === r
              ? "bg-muted font-semibold text-foreground"
              : "font-medium text-muted-foreground hover:text-foreground",
          )}
        >
          {t(r)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

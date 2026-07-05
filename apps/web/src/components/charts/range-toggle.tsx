"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

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
  theme = "default",
}: {
  value: ChartRange;
  onChange: (range: ChartRange) => void;
  disabled?: boolean;
  /** Subset of ranges to render as chips (e.g. the hero card only shows 1D/7D/1M/1Y/ALL). */
  ranges?: readonly ChartRange[];
  /** "inverse" = white-on-green pills for use inside a dark/brand-colored hero card. */
  theme?: "default" | "inverse";
}) {
  const t = useTranslations("Chart.range");
  // Transcribed from `Pocket Prototype.dc.html`: hero (`pOn`/`pOff`) = flex:1 buttons
  // spanning the full chart width, white pill w/ green text when active; default
  // (`pdOn`/`pdOff`) = compact 11px buttons, active = card bg + small shadow.
  return (
    <div
      className={cn("flex", theme === "inverse" ? "w-full gap-1.5" : "gap-0.5")}
      role="group"
      aria-label={t("label")}
    >
      {ranges.map((r) => (
        <button
          key={r}
          type="button"
          disabled={disabled}
          onClick={() => onChange(r)}
          aria-pressed={value === r}
          className={cn(
            "transition-colors disabled:opacity-50",
            theme === "inverse"
              ? cn(
                  "flex-1 rounded-full py-1.5 text-center text-xs",
                  value === r
                    ? "bg-white font-bold text-[#0B7D58]"
                    : "bg-transparent font-semibold text-white/85 hover:bg-white/10",
                )
              : cn(
                  "rounded-lg px-[11px] py-1.5 text-[11px]",
                  value === r
                    ? "bg-card font-bold text-foreground shadow-[0_1px_3px_rgba(15,27,20,.14)]"
                    : "font-semibold text-text-2 hover:text-foreground",
                ),
          )}
        >
          {t(r)}
        </button>
      ))}
    </div>
  );
}

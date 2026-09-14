"use client";

import {
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  useActiveTooltipDataPoints,
  useActiveTooltipLabel,
  useIsTooltipActive,
} from "recharts";
import { useMemo } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ChartTooltipPanel } from "@/components/ui/chart-tooltip-panel";
import { formatMoney, formatPercent } from "@/lib/utils";

export interface HeroOverlayPoint {
  date: string;
  portfolio: number;
  benchmark: number | null;
}

/**
 * The Holdings glance hero chart. Two TWR-rebased `<Line>`s on a shared base of 100:
 *   - portfolio: white solid, drawn in front
 *   - benchmark: yellow dashed, drawn behind (or omitted entirely when its series
 *     is all-null, e.g. intraday or "no benchmark configured").
 *
 * No axes, no grid, no legend — the parent renders the legend so the
 * benchmark label can be localised via next-intl. Inherits its container's width and
 * the standard hero height (~74px). Hovering any point shows a standard
 * {@link ChartTooltipPanel} with the date + portfolio value + benchmark value
 * (benchmark row omitted when its series is null at that date). The tooltip
 * follows Recharts' Pattern A2 (v3 hooks + custom `content`), matching
 * `ContributionsChart`, `IncomeBarChart`, etc.
 */
export function HeroOverlayChart({
  points,
  isIntraday,
  currency,
}: {
  points: HeroOverlayPoint[];
  /** True for 1D/7D ranges — points carry absolute currency, not TWR %. Controls
   *  tooltip value formatting (`formatMoney` vs `formatPercent`) and date label
   *  parsing (intraday labels like "14:30"/"3 Jul" pass through; ISO dates format). */
  isIntraday: boolean;
  currency: string;
}) {
  const locale = useLocale();
  return (
    <div data-testid="hero-overlay-chart" className="w-full" style={{ height: 74 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 16, right: 0, left: 0, bottom: 0 }}>
          <Line
            type="monotone"
            dataKey="benchmark"
            stroke="#FFD24A"
            strokeWidth={1.8}
            strokeDasharray="5 3"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="portfolio"
            stroke="#ffffff"
            strokeWidth={2.2}
            dot={false}
            isAnimationActive={false}
          />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,.55)", strokeDasharray: "4 4" }}
            content={<HeroTooltip isIntraday={isIntraday} currency={currency} locale={locale} />}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Custom tooltip content for {@link HeroOverlayChart}. Lives in the Recharts
 * context, reads the hovered point via v3 hooks, and delegates rendering to the
 * shared {@link ChartTooltipPanel}. Date label formatting mirrors `PriceChart`'s
 * tooltip (intraday labels pass through; ISO dates format via `Intl.DateTimeFormat`).
 */
function HeroTooltip({
  isIntraday,
  currency,
  locale,
}: {
  isIntraday: boolean;
  currency: string;
  locale: string;
}) {
  const t = useTranslations("Holdings.hero");
  const active = useIsTooltipActive();
  // Touching `useActiveTooltipLabel` keeps the hook order stable if Recharts
  // re-renders the tooltip wrapper at a different point in its lifecycle; we
  // derive the title from `p.date` instead because day-grained `<XAxis>`/`<ComposedChart>`
  // would otherwise surface a raw row index here.
  useActiveTooltipLabel();
  const pointsData = useActiveTooltipDataPoints<HeroOverlayPoint>();

  const dateLabelFmt = useMemo(
    () =>
      isIntraday
        ? null
        : new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }),
    [isIntraday, locale],
  );

  if (!active || !pointsData?.length) return null;
  const p = pointsData[0];

  const title = formatHeroDateLabel(p.date, isIntraday, dateLabelFmt);

  const rows = [
    {
      label: t("legendPortfolio"),
      value: isIntraday
        ? formatMoney(p.portfolio, currency, locale)
        : formatPercent(p.portfolio / 100, locale),
      dot: "#ffffff",
    },
  ];
  if (p.benchmark !== null) {
    rows.push({
      label: t("tooltipBenchmark"),
      value: isIntraday
        ? formatMoney(p.benchmark, currency, locale)
        : formatPercent(p.benchmark / 100, locale),
      dot: "#FFD24A",
    });
  }

  return <ChartTooltipPanel title={title} rows={rows} />;
}

/**
 * Format the hovered point's date for the tooltip title. Day-grained points
 * carry a raw ISO date (YYYY-MM-DD) → format it; intraday points already carry
 * a display label (e.g. "14:30", "3 Jul") → pass through untouched. If parsing
 * fails, fall back to the raw string.
 */
function formatHeroDateLabel(
  raw: string,
  isIntraday: boolean,
  fmt: Intl.DateTimeFormat | null,
): string {
  if (!raw) return "";
  if (!isIntraday) {
    if (!fmt) return raw;
    if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? raw : fmt.format(d);
  }
  return raw;
}

"use client";

import { ComposedChart, Line, ResponsiveContainer } from "recharts";

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
 * No axes, no grid, no tooltip, no legend — the parent renders the legend so the
 * benchmark label can be localised via next-intl. Inherits its container's width and
 * the standard hero height (~74px).
 */
export function HeroOverlayChart({ points }: { points: HeroOverlayPoint[] }) {
  return (
    <div data-testid="hero-overlay-chart" className="w-full" style={{ height: 74 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <Line
            type="monotone"
            dataKey="benchmark"
            stroke="#FFD24A"
            strokeWidth={1.8}
            strokeDasharray="5 3"
            dot={false}
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
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

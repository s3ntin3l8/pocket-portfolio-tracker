/**
 * The one set of Recharts styling constants, so every chart draws its grid, axes, cursor and
 * dashed series the same way. Colours are theme tokens (`var(--color-*)`), never hex.
 */

/** Horizontal-only dashed gridlines. Spread onto `<CartesianGrid>`. */
export const CHART_GRID = {
  stroke: "var(--color-border)",
  strokeDasharray: "3 3",
  vertical: false,
} as const;

/** Axis tick label style (11px, muted). */
export const CHART_AXIS_TICK = { fontSize: 11, fill: "var(--color-muted-foreground)" } as const;

/** The hover cursor line for a chart tooltip. */
export const CHART_CURSOR = {
  stroke: "color-mix(in srgb, var(--color-muted-foreground) 55%, transparent)",
  strokeDasharray: "4 4",
} as const;

/** Dash pattern for a secondary or projected series (benchmark, contributed, forecast). */
export const CHART_SERIES_DASH = "4 3";

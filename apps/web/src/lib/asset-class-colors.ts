/** Stable chart colors for asset classes, matching the chart palette in globals.css. */
const ASSET_CLASS_COLORS: Record<string, string> = {
  equity: "var(--color-chart-1)",
  gold: "var(--color-chart-2)",
  bond: "var(--color-chart-3)",
  etf: "var(--color-chart-4)",
  mutual_fund: "var(--color-chart-4)",
  crypto: "var(--color-chart-6)",
  cash: "var(--color-chart-5)",
};

/** Fallback sequence for allocation categories without a dedicated asset-class color. */
export const ASSET_CLASS_COLOR_PALETTE = [...new Set(Object.values(ASSET_CLASS_COLORS))];

export function assetClassColor(key: string, fallback: string): string {
  return ASSET_CLASS_COLORS[key] ?? fallback;
}

import { cn } from "@/lib/utils";

/**
 * A tiny static price-course sparkline for a mobile holdings row (reference "Pocket
 * Prototype" design). Renders the reference's exact 52×24 polyline. Colored by the
 * series' OWN trend (first vs last close) — deliberately not the row's unrealized-P&L
 * color, since a position can be up overall while its recent course is down.
 *
 * `values` are recent daily closes, oldest→newest. Renders nothing for <2 points (the
 * caller also gates on this); a flat series draws a midline instead of dividing by zero.
 */
export function HoldingSparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  if (values.length < 2) return null;

  const W = 60;
  const H = 26;
  const PAD = 3; // keep the 2px round-capped stroke inside the box

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = range === 0 ? H / 2 : PAD + (H - 2 * PAD) * (1 - (v - min) / range);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const up = values[values.length - 1] >= values[0];

  return (
    <svg
      viewBox="0 0 60 26"
      width={52}
      height={24}
      aria-hidden
      className={cn("shrink-0", up ? "text-success" : "text-destructive", className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

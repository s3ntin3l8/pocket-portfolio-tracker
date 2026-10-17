import { cn } from "@/lib/utils";

/** Placeholder shown while a lazily-loaded (`next/dynamic`) chart chunk is fetched —
 *  reserves the chart's height so the surrounding card doesn't jump when it arrives.
 *  `data-chart-loading` marks the pending state for the screenshot capture (it is
 *  aria-hidden, so aria-busy here would be pruned from the a11y tree anyway). */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      data-chart-loading
      className={cn("min-h-[200px] w-full animate-pulse rounded-xl bg-muted/40", className)}
    />
  );
}

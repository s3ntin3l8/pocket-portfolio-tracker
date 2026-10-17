import { cn } from "@/lib/utils";

/** Placeholder shown while a lazily-loaded (`next/dynamic`) chart chunk is fetched —
 *  reserves the chart's height so the surrounding card doesn't jump when it arrives.
 *  `aria-busy` marks the pending state (the screenshot capture waits on it). */
export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      aria-busy
      className={cn("min-h-[200px] w-full animate-pulse rounded-xl bg-muted/40", className)}
    />
  );
}

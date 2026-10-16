"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared visual shell for all chart tooltips in the app. Renders a
 * card-surface panel (bordered, hairline shadow) with a title row and a list of label/value rows
 * (each row can carry an optional 8x8 colored dot). Matches the visual
 * styling of Recharts' built-in `<Tooltip>` so every chart in the app
 * (donut, bar, area, overlay, and the bespoke non-Recharts tooltips
 * described in #478 — heatmap, sparkline, split bar) reads consistently.
 *
 * Position is the caller's responsibility: Recharts' `<Tooltip content={…}>`
 * positions this inside its own portal; the bespoke tooltips use
 * {@link useChartTooltip} and `createPortal(..., document.body)` with
 * `position: fixed` coordinates. This component only renders the inner
 * card.
 *
 * `onSize` reports the panel's measured dimensions back to the caller so
 * the positioning hook can flip the tooltip away from the viewport edge
 * using the *real* panel size instead of an approximation. This is the
 * #5 follow-up from the #478 review: previously `useChartTooltip` used
 * a fixed `TIP_W=200, TIP_H=80` to decide whether to flip, which could
 * overflow on longer or multi-row tooltips. The first render still uses
 * the hook's approximation (the panel isn't measured yet); once it
 * mounts, the real size flows back and the next `update()` uses it.
 */

export interface ChartTooltipRow {
  label: string;
  value: string;
  /** Optional 8x8 colored dot rendered before the label. */
  dot?: string;
  dotOpacity?: number;
}

export function ChartTooltipPanel({
  title,
  rows,
  onSize,
}: {
  title?: string;
  rows: ChartTooltipRow[];
  /**
   * Called whenever the rendered panel resizes (initial mount + every
   * subsequent size change). Wired by {@link useChartTooltip} via its
   * returned `setSize` so the hook can flip the tooltip away from
   * viewport edges using the real panel footprint.
   */
  onSize?: (size: { width: number; height: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onSize || !ref.current) return;
    const el = ref.current;
    // Fire the initial size synchronously so the hook's next update() can
    // use the real dimensions without waiting for a ResizeObserver tick.
    onSize({ width: el.offsetWidth, height: el.offsetHeight });
    // Explicit `entries: ResizeObserverEntry[]` annotation. The callback
    // signature in lib.dom.d.ts is `(entries, observer) => void`, and the
    // CodeQL `js/superfluous-trailing-arguments` rule misreads the
    // inferred single-arg form as "passing an unexpected argument to the
    // default constructor." Annotating the first parameter makes the
    // intended type explicit and silences the false positive without
    // needing a codeql suppression comment.
    const ro = new ResizeObserver((entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      onSize({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onSize]);

  if (rows.length === 0) return null;
  return (
    <div
      ref={ref}
      className="min-w-42 rounded-md border border-border bg-card px-3 py-2 text-xs text-card-foreground shadow-hairline"
    >
      {title && <p className="mb-1.5 font-semibold">{title}</p>}
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={cn("flex items-center justify-between gap-3.5", i > 0 && "mt-1")}
        >
          <span className="flex items-center gap-1.5 text-muted-foreground">
            {row.dot && (
              <span
                className="inline-block size-2 rounded-xs"
                style={{ background: row.dot, opacity: row.dotOpacity ?? 1 }}
              />
            )}
            {row.label}
          </span>
          <span className="tabular font-semibold">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

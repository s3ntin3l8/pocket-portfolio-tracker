import type { LucideIcon } from "lucide-react";
import { ScopeLink } from "@/components/scope-link";
import { Card } from "@/components/ui/card";
import { TrendChip, type TrendTone } from "@/components/reports/trend-chip";
import { MiniSplitBar, type MiniSplitBarSegment } from "@/components/reports/mini-split-bar";
import { ResponsiveMoney } from "@/components/ui/responsive-money";
import { TwoStatFooter } from "@/components/reports/two-stat-footer";

/**
 * A statement card for the Reports hub: neutral icon chip + title + trend chip, a big headline
 * value + caption, an optional two-segment split bar, and a footer of up to two metrics
 * plus an "Open ›" affordance. Server-renderable — the whole card is a `<Link>` rather
 * than taking an `onOpen` closure (the design's `r.on`), since this composes inside a
 * server component page and a function prop can't cross that boundary.
 */
export function ReportCard({
  icon: Icon,
  title,
  trend,
  value,
  valueCompact,
  caption,
  splitBar,
  metrics,
  href,
  openLabel,
  gain,
}: {
  icon: LucideIcon;
  title: string;
  trend?: { label: string; tone: TrendTone; arrow?: boolean };
  value: string;
  /** Compact form of `value` shown below the `sm` breakpoint so a large figure never needs an ellipsis. */
  valueCompact?: string;
  caption: string;
  splitBar?: MiniSplitBarSegment[];
  metrics: Array<{ label: string; value: string; color?: string }>;
  href: string;
  openLabel: string;
  /** A labelled gain figure (`GainFigure`) shown under the caption — present on cards whose
   *  headline value has a gain against a stated basis (audit G2). Plain text, so it is safe
   *  inside the card's link. */
  gain?: React.ReactNode;
}) {
  // Neutral icon chip + title + trend chip in one header row, a display-size value, a muted
  // caption, an optional split bar, and a bordered footer pinned to the card bottom.
  return (
    <ScopeLink href={href} className="group block h-full">
      <Card className="flex h-full min-w-0 flex-col p-5 transition-shadow group-hover:ring-1 group-hover:ring-primary/40">
        {/* flex-wrap: on a phone a long trend label ("+118.79% full-year est. vs last
            year") moves to its own line instead of squeezing the title against it. The
            title must keep its content width (`flex-none`, not `flex-1`, whose 0% basis
            would let the row "fit" by crushing the title); `max-w-full` + `break-words` let a
            title longer than the whole row still wrap rather than overflow. The chip
            right-aligns via `ml-auto` on either line. */}
        <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-[18px]" strokeWidth={1.9} />
          </span>
          <span className="max-w-full flex-none break-words text-body font-semibold">{title}</span>
          {trend && (
            <span className="ml-auto min-w-0 max-w-full">
              <TrendChip label={trend.label} tone={trend.tone} arrow={trend.arrow} />
            </span>
          )}
        </div>

        <p className="tabular mt-4 text-display font-bold">
          <ResponsiveMoney full={value} compact={valueCompact} />
        </p>
        <p className="mt-[3px] truncate text-body-sm font-medium text-text-2">{caption}</p>

        {gain && <div className="mt-2">{gain}</div>}

        {splitBar && splitBar.length > 0 && (
          <div className="mt-4">
            <MiniSplitBar segments={splitBar} />
          </div>
        )}

        <TwoStatFooter metrics={metrics} openLabel={openLabel} />
      </Card>
    </ScopeLink>
  );
}

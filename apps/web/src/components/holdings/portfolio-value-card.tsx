import { cn } from "@/lib/utils";
import { GainFigure, type Tone } from "@/components/gain-figure";

export type { Tone };

const toneClass = (tone: Tone) =>
  tone === "up" ? "text-success" : tone === "down" ? "text-destructive" : "";

/**
 * The three headline stats (Total value, All-time P&L, Today's change) displayed
 * as their own card at the top of the Holdings sidebar — above the allocation donut.
 * Extracted from `AllocationCard`'s former stats strip to give these figures visual
 * prominence as the first sidebar element.
 */
export function PortfolioValueCard({
  totalLabel,
  totalValueFormatted,
  allTimeLabel,
  allTimeAmount,
  allTimePct,
  allTimeTone = "flat",
  allTimeExplainer,
  todayLabel,
  todayAmount,
  todayPct,
  todayTone = "flat",
}: {
  totalLabel: string;
  totalValueFormatted: string;
  allTimeLabel: string;
  allTimeAmount: string;
  allTimePct: string | null;
  allTimeTone?: Tone;
  /** The shared "how is this gain calculated?" trigger (`GainExplainer`), rendered under the figure. */
  allTimeExplainer?: React.ReactNode;
  todayLabel: string;
  todayAmount: string;
  todayPct: string | null;
  todayTone?: Tone;
}) {
  return (
    <div className="rounded-xl bg-card px-6 py-5 shadow-card">
      <div className="flex flex-col gap-3">
        {/* Total value */}
        <div>
          <p className="text-micro font-semibold text-text-3">{totalLabel}</p>
          <p className="tabular mt-0.5 text-heading font-extrabold">{totalValueFormatted}</p>
        </div>
        {/* All-time P&L */}
        <div className="border-t border-line pt-3">
          <p className="text-micro font-semibold text-text-3">{allTimeLabel}</p>
          <GainFigure
            amount={allTimeAmount}
            pct={allTimePct}
            tone={allTimeTone}
            basis="cost"
            className="mt-0.5"
          />
          {allTimeExplainer && <div className="mt-1.5">{allTimeExplainer}</div>}
        </div>
        {/* Today's change */}
        <div className="border-t border-line pt-3">
          <p className="text-micro font-semibold text-text-3">{todayLabel}</p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <p className={cn("tabular text-lg font-extrabold", toneClass(todayTone))}>
              {todayAmount}
            </p>
            {todayPct != null && (
              <p className={cn("tabular text-body-sm font-bold", toneClass(todayTone))}>
                {todayPct}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

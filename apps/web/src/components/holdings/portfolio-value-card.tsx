import { cn } from "@/lib/utils";

/** Direction of a gain figure — drives the value colour (green up / red down / neutral). */
export type Tone = "up" | "down" | "flat";

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
  todayLabel: string;
  todayAmount: string;
  todayPct: string | null;
  todayTone?: Tone;
}) {
  return (
    <div className="rounded-[18px] bg-card px-6 py-5 shadow-card">
      <div className="flex flex-col gap-3">
        {/* Total value */}
        <div>
          <p className="text-[11px] font-semibold text-text-3">{totalLabel}</p>
          <p className="tabular mt-0.5 text-[22px] font-extrabold">{totalValueFormatted}</p>
        </div>
        {/* All-time P&L */}
        <div className="border-t border-line pt-3">
          <p className="text-[11px] font-semibold text-text-3">{allTimeLabel}</p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <p className={cn("tabular text-[18px] font-extrabold", toneClass(allTimeTone))}>
              {allTimeAmount}
            </p>
            {allTimePct != null && (
              <p className={cn("tabular text-[13px] font-bold", toneClass(allTimeTone))}>
                {allTimePct}
              </p>
            )}
          </div>
        </div>
        {/* Today's change */}
        <div className="border-t border-line pt-3">
          <p className="text-[11px] font-semibold text-text-3">{todayLabel}</p>
          <div className="mt-0.5 flex items-baseline gap-2">
            <p className={cn("tabular text-[18px] font-extrabold", toneClass(todayTone))}>
              {todayAmount}
            </p>
            {todayPct != null && (
              <p className={cn("tabular text-[13px] font-bold", toneClass(todayTone))}>
                {todayPct}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

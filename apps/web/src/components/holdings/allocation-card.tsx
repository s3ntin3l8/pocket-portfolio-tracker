import { AllocationDonut, type DonutSlice } from "@/components/charts/allocation-donut";

/**
 * The Holdings "Allocation" card: the class-donut (reused wholesale, incl. its own
 * legend) plus, on desktop only, a third column with the total value and a couple of
 * mini-stats (all-time return, today's change). No card title — the reference shows the
 * donut directly (its own center label already reads "Assets"), and no tab switcher
 * either — unlike `AllocationTabs` (Class|Currency|Region|Sector), the design shows only
 * the class breakdown on this screen; Region/Currency get their own card below (see
 * `RegionCurrencyCard`), and Sector isn't shown on Holdings at all.
 */
export function AllocationCard({
  slices,
  currency,
  total,
  totalLabel,
  totalValueFormatted,
  allTimeLabel,
  allTimePct,
  todayLabel,
  todayAmount,
}: {
  slices: DonutSlice[];
  currency: string;
  /** Sum of `slices` — passed straight through to `AllocationDonut` for its center label. */
  total: number;
  totalLabel: string;
  /** Pre-formatted (locale-aware) total value for the desktop-only third column. */
  totalValueFormatted: string;
  allTimeLabel: string;
  allTimePct: string | null;
  todayLabel: string;
  todayAmount: string;
}) {
  // Transcribed from `Pocket Prototype.dc.html`: padding 20px 24px, grid auto/1fr/auto
  // gap-28px; right column separated by a --line border, labels 600 11px text-3,
  // total 800 22px, all-time/today 700 15px.
  return (
    <div className="rounded-[18px] bg-card px-6 py-5 shadow-card">
      <div className="grid items-center gap-7 lg:grid-cols-[1fr_auto]">
        <div>
          <AllocationDonut data={slices} currency={currency} total={total} />
        </div>
        <div className="hidden flex-col gap-3.5 border-l border-line pl-7 lg:flex">
          <div>
            <p className="text-[11px] font-semibold text-text-3">{totalLabel}</p>
            <p className="tabular mt-0.5 text-[22px] font-extrabold">{totalValueFormatted}</p>
          </div>
          <div className="flex gap-[22px]">
            <div>
              <p className="text-[11px] font-semibold text-text-3">{allTimeLabel}</p>
              <p className="tabular mt-0.5 text-[15px] font-bold text-success">
                {allTimePct ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold text-text-3">{todayLabel}</p>
              <p className="tabular mt-0.5 text-[15px] font-bold">{todayAmount}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

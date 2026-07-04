import { AllocationDonut, type DonutSlice } from "@/components/charts/allocation-donut";

/**
 * The Holdings "Allocation" card: the class-donut (reused wholesale, incl. its own
 * legend) plus, on desktop only, a third column with the total value and a couple of
 * mini-stats (all-time return, today's change). No tab switcher here — unlike
 * `AllocationTabs` (Class|Currency|Region|Sector), the design shows only the class
 * breakdown on this screen; Region/Currency get their own card below (see
 * `RegionCurrencyCard`), and Sector isn't shown on Holdings at all.
 */
export function AllocationCard({
  title,
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
  title: string;
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
  return (
    <div className="rounded-[22px] border border-border bg-card p-[18px] shadow-[0_1px_2px_rgba(15,27,20,.04),0_6px_16px_rgba(15,27,20,.05)]">
      <div className="border-b border-border pb-3.5 text-sm font-bold">{title}</div>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_auto_1fr]">
        <div>
          <AllocationDonut data={slices} currency={currency} total={total} />
        </div>
        <div className="hidden border-l border-border lg:block" />
        <div className="hidden flex-col justify-center gap-4 lg:flex">
          <div>
            <p className="text-xs text-muted-foreground">{totalLabel}</p>
            <p className="tabular mt-1 text-xl font-extrabold">{totalValueFormatted}</p>
          </div>
          <div className="flex gap-6">
            <div>
              <p className="text-xs text-muted-foreground">{allTimeLabel}</p>
              <p className="tabular text-sm font-semibold text-success">{allTimePct ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{todayLabel}</p>
              <p className="tabular text-sm font-semibold">{todayAmount}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

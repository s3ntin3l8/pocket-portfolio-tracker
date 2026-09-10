import { AllocationDonut, type DonutSlice } from "@/components/charts/allocation-donut";

/**
 * The Holdings "Allocation" card: the class-donut (reused wholesale, incl. its own
 * legend). The three portfolio-value stats (Total value / All-time / Today) live in
 * their own `PortfolioValueCard` rendered above this card in the sidebar.
 *
 * No card title — the donut's center label reads "Assets". No tab switcher either —
 * unlike `AllocationTabs` (Class|Currency|Region|Sector), the design shows only the
 * class breakdown here; Region/Currency are always-visible sections rendered below
 * this card in the sidebar (outside the asset-class gate so they survive even when
 * a portfolio holds only non-classified instruments). Sector isn't shown on Holdings.
 */
export function AllocationCard({
  slices,
  currency,
  total,
}: {
  slices: DonutSlice[];
  currency: string;
  /** Sum of `slices` — passed straight through to `AllocationDonut` for its center label. */
  total: number;
}) {
  return (
    <div className="@container rounded-[18px] bg-card px-6 py-5 shadow-card">
      <AllocationDonut data={slices} currency={currency} total={total} />
    </div>
  );
}

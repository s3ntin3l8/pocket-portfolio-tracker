import { useTranslations } from "next-intl";
import type { DonutSlice } from "@/components/charts/allocation-donut";
import { AllocationDonutSsr as AllocationDonut } from "@/components/charts/lazy";

/**
 * The Holdings "Allocation" card: the class-donut (reused wholesale, incl. its own
 * legend). The three portfolio-value stats (Total value / All-time / Today) live in
 * their own `PortfolioValueCard` rendered above this card in the sidebar.
 *
 * No tab switcher — unlike `AllocationTabs` (Class|Currency|Region|Sector), the
 * design shows only the class breakdown here; Region/Currency are always-visible
 * sections rendered below this card in the sidebar (outside the asset-class gate
 * so they survive even when a portfolio holds only non-classified instruments).
 * Sector isn't shown on Holdings.
 */
export function AllocationCard({
  title,
  slices,
  currency,
  total,
  atCostLegend,
}: {
  title: string;
  slices: DonutSlice[];
  currency: string;
  /** Sum of `slices` — passed straight through to `AllocationDonut` for its center label. */
  total: number;
  /** Legend note for the hatched at-cost share (see `DonutSlice.atCostValue`). */
  atCostLegend?: string;
}) {
  const tHoldings = useTranslations("Holdings");
  return (
    <div className="@container rounded-xl bg-card px-6 py-5 shadow-card">
      <p className="mb-3 text-micro font-semibold uppercase tracking-label text-text-2">{title}</p>
      <AllocationDonut
        data={slices}
        currency={currency}
        total={total}
        atCostLegend={atCostLegend}
        atCostLabel={tHoldings("valuedAtCostBadge")}
      />
    </div>
  );
}

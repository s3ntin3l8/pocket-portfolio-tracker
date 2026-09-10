import { AllocationDonut, type DonutSlice } from "@/components/charts/allocation-donut";

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

interface RegionCurrencyRow {
  key: string;
  label: string;
  pct: number;
}

function Section({ title, rows }: { title: string; rows: RegionCurrencyRow[] }) {
  return (
    <div className="min-w-0">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.04em] text-text-3">
        {title}
      </p>
      {rows.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-5 gap-y-2.5 @sm:grid-cols-2 @sm:gap-x-7 @lg:grid-cols-3">
          {rows.map((r, i) => (
            <div key={r.key} className="flex items-center gap-[9px]">
              <span
                className="size-[9px] shrink-0 rounded-[2px]"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{r.label}</span>
              <span className="tabular shrink-0 text-[13px] font-bold text-text-2">
                {r.pct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}

/**
 * The Holdings "Allocation" card: the class-donut (reused wholesale, incl. its own
 * legend), followed by "By region" / "By currency" sections folded in below the donut.
 * The three portfolio-value stats (Total value / All-time / Today) have been extracted
 * into their own `PortfolioValueCard` rendered above this card in the sidebar.
 *
 * No card title — the donut's center label reads "Assets". No tab switcher either —
 * unlike `AllocationTabs` (Class|Currency|Region|Sector), the design shows only the
 * class breakdown here; Region/Currency are always-visible lists below the donut.
 * Sector isn't shown on Holdings at all.
 */
export function AllocationCard({
  slices,
  currency,
  total,
  regionTitle,
  currencyTitle,
  regionRows,
  currencyRows,
}: {
  slices: DonutSlice[];
  currency: string;
  /** Sum of `slices` — passed straight through to `AllocationDonut` for its center label. */
  total: number;
  regionTitle: string;
  currencyTitle: string;
  regionRows: RegionCurrencyRow[];
  currencyRows: RegionCurrencyRow[];
}) {
  return (
    <div className="@container rounded-[18px] bg-card px-6 py-5 shadow-card">
      <AllocationDonut data={slices} currency={currency} total={total} />

      {(regionRows.length > 0 || currencyRows.length > 0) && (
        <div className="mt-5 space-y-5 border-t border-line pt-5">
          <Section title={regionTitle} rows={regionRows} />
          <div className="border-t border-line pt-5">
            <Section title={currencyTitle} rows={currencyRows} />
          </div>
        </div>
      )}
    </div>
  );
}

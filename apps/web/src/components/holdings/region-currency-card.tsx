const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

interface Row {
  key: string;
  label: string;
  pct: number;
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
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
 * "By region / By currency" allocation lists on Holdings — reads off the same
 * `AllocationBreakdown.byRegion` / `.byCurrency` dimensions the AllocationTabs
 * already consumes for its Region/Currency tabs; no separate API call.
 *
 * Rendered outside the asset-class gate so these sections survive even when a
 * portfolio holds only non-classified instruments (no `byAssetClass` slices).
 */
export function RegionCurrencyCard({
  regionTitle,
  currencyTitle,
  regionRows,
  currencyRows,
}: {
  regionTitle: string;
  currencyTitle: string;
  regionRows: Row[];
  currencyRows: Row[];
}) {
  return (
    <div className="@container flex flex-col gap-5 rounded-[18px] bg-card px-6 py-5 shadow-card">
      <Section title={regionTitle} rows={regionRows} />
      <div className="border-t border-line pt-5">
        <Section title={currencyTitle} rows={currencyRows} />
      </div>
    </div>
  );
}

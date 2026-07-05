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

function Column({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="min-w-0 flex-1 space-y-2.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {rows.length > 0 ? (
        rows.map((r, i) => (
          <div key={r.key} className="flex items-center gap-2 text-sm">
            <span
              className="size-2 shrink-0 rounded-sm"
              style={{ background: COLORS[i % COLORS.length] }}
            />
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            <span className="tabular shrink-0 text-muted-foreground">{r.pct.toFixed(1)}%</span>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}

/**
 * Always-visible "By region / By currency" two-column list on Holdings — reads off the
 * same `AllocationBreakdown.byRegion` / `.byCurrency` dimensions `AllocationTabs` already
 * consumes for its Region/Currency tabs; no separate API call.
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
    <div className="flex gap-6 rounded-xl bg-card p-[18px] shadow-card sm:gap-8">
      <Column title={regionTitle} rows={regionRows} />
      <div className="w-px shrink-0 bg-border" />
      <Column title={currencyTitle} rows={currencyRows} />
    </div>
  );
}

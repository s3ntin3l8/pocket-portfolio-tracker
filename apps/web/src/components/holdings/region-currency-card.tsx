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

// Transcribed from `Pocket Prototype.dc.html`: section head 600 11px uppercase .04em
// text-3 mb-12px; rows gap-10px, 9×9 2px-radius square swatch, label 600 13px,
// pct 700 13px text-2.
function Column({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[.04em] text-text-3">
        {title}
      </p>
      {rows.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <div key={r.key} className="flex items-center gap-[9px]">
              <span
                className="size-[9px] shrink-0 rounded-[2px]"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                {r.label}
              </span>
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
    <div className="grid grid-cols-2 gap-7 rounded-[18px] bg-card px-6 py-5 shadow-card">
      <Column title={regionTitle} rows={regionRows} />
      <div className="border-l border-line pl-7">
        <Column title={currencyTitle} rows={currencyRows} />
      </div>
    </div>
  );
}

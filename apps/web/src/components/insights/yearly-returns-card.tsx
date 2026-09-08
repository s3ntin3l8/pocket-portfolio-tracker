"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { ChartTooltipPanel, type ChartTooltipRow } from "@/components/ui/chart-tooltip-panel";
import { cn, formatPercent } from "@/lib/utils";
import { benchmarkLabel } from "@/lib/benchmark-labels";
import type { BenchmarkSymbolEntry, YearlyReturnRow } from "@portfolio/api-client";

const CHART_PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
];

interface YearlyReturnsCardProps {
  rows: YearlyReturnRow[];
  symbols: BenchmarkSymbolEntry[];
  currency: string;
  locale: string;
}

export function YearlyReturnsCard({ rows, symbols, currency, locale }: YearlyReturnsCardProps) {
  const t = useTranslations("Insights.yearlyReturns");

  // Chart data: one row per year, one numeric series per benchmark (decimal fraction × 100).
  // The portfolio series is included so the user can compare at a glance without reading
  // the table; the table itself has the exact numbers.
  const chartData = useMemo(
    () =>
      rows.map((r) => {
        const out: { year: string; portfolio: number | null; [k: string]: number | string | null } =
          {
            year: r.isCurrentYear ? `${r.year} ${t("ytdLabel")}` : String(r.year),
            portfolio: r.portfolioTwr !== null ? Number(r.portfolioTwr) * 100 : null,
          };
        for (const b of r.benchmarks) {
          out[b.symbol] = b.twr !== null ? Number(b.twr) * 100 : null;
        }
        return out;
      }),
    [rows, t],
  );

  const benchmarkColumnKeys = symbols.map((s) => s.symbol);
  const benchmarkLabels = useMemo(
    () =>
      Object.fromEntries(symbols.map((s) => [s.symbol, s.displayName || benchmarkLabel(s.symbol)])),
    [symbols],
  );

  if (rows.length === 0) {
    return (
      <Card className="rounded-2xl bg-card p-4 shadow-card">
        <p className="text-xs font-semibold text-text-2">{t("title")}</p>
        <p className="mt-2 text-xs text-text-3">{t("insufficientData")}</p>
      </Card>
    );
  }

  const subtitle = t("subtitle", {
    currency,
    benchmarks: symbols.map((s) => s.displayName || benchmarkLabel(s.symbol)).join(" · "),
  });

  return (
    <Card className="rounded-2xl bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-text-2">{t("title")}</p>
          <p className="mt-0.5 truncate text-[11px] text-text-3">{subtitle}</p>
        </div>
      </div>

      <div className="mt-3 h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 10, fill: "var(--color-text-3)" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--color-text-3)" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={32}
            />
            <Tooltip
              cursor={{ fill: "var(--color-accent)", opacity: 0.4 }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const tooltipRows: ChartTooltipRow[] = [];
                const portfolioEntry = payload.find((p) => p.dataKey === "portfolio");
                if (portfolioEntry && portfolioEntry.value !== null) {
                  tooltipRows.push({
                    label: t("headerPortfolioTwr"),
                    value: formatPercent(Number(portfolioEntry.value) / 100, locale),
                  });
                }
                for (const p of payload) {
                  if (p.dataKey === "portfolio") continue;
                  const sym = String(p.dataKey);
                  if (p.value === null) {
                    tooltipRows.push({ label: benchmarkLabel(sym), value: t("noData") });
                  } else {
                    tooltipRows.push({
                      label: benchmarkLabel(sym),
                      value: formatPercent(Number(p.value) / 100, locale),
                    });
                  }
                }
                return <ChartTooltipPanel title={String(label)} rows={tooltipRows} />;
              }}
            />
            <Bar dataKey="portfolio" fill={CHART_PALETTE[0]} radius={[3, 3, 0, 0]} />
            {benchmarkColumnKeys.map((sym, i) => (
              <Bar
                key={sym}
                dataKey={sym}
                fill={CHART_PALETTE[(i + 1) % CHART_PALETTE.length]}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-text-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: CHART_PALETTE[0] }} />
          Portfolio
        </span>
        {benchmarkColumnKeys.map((sym, i) => (
          <span key={sym} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[3px]"
              style={{ background: CHART_PALETTE[(i + 1) % CHART_PALETTE.length] }}
            />
            {benchmarkLabels[sym]}
          </span>
        ))}
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-text-3">
              <th className="px-2 py-1.5 text-left font-semibold">{t("headerYear")}</th>
              <th className="px-2 py-1.5 text-right font-semibold">{t("headerPortfolioTwr")}</th>
              <th className="px-2 py-1.5 text-right font-semibold">{t("headerPortfolioXirr")}</th>
              {symbols.map((s) => (
                <th key={s.symbol} className="px-2 py-1.5 text-right font-semibold">
                  {s.displayName || benchmarkLabel(s.symbol)}
                </th>
              ))}
              {symbols.map((s) => (
                <th key={`act-${s.symbol}`} className="px-2 py-1.5 text-right font-semibold">
                  {t("headerActiveReturn", { symbol: s.displayName || benchmarkLabel(s.symbol) })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} className="border-b border-border/50 last:border-0">
                <td className="px-2 py-1.5 text-left text-xs font-medium text-text-2">
                  {r.year}
                  {r.isCurrentYear && (
                    <span className="ml-1 text-[10px] text-text-3">· {t("ytdLabel")}</span>
                  )}
                </td>
                <td className="tabular px-2 py-1.5 text-right text-xs">
                  {r.portfolioTwr !== null ? (
                    <PercentCell value={Number(r.portfolioTwr)} locale={locale} />
                  ) : (
                    <span className="text-text-3">{t("noData")}</span>
                  )}
                </td>
                <td className="tabular px-2 py-1.5 text-right text-xs">
                  {r.portfolioXirr !== null ? (
                    <PercentCell value={Number(r.portfolioXirr)} locale={locale} />
                  ) : (
                    <span className="text-text-3">{t("noData")}</span>
                  )}
                </td>
                {r.benchmarks.map((b) => (
                  <td key={b.symbol} className="tabular px-2 py-1.5 text-right text-xs">
                    {b.twr !== null ? (
                      <PercentCell value={Number(b.twr)} locale={locale} />
                    ) : (
                      <span className="text-text-3">{t("noData")}</span>
                    )}
                  </td>
                ))}
                {r.benchmarks.map((b) => (
                  <td key={`act-${b.symbol}`} className="tabular px-2 py-1.5 text-right text-xs">
                    {b.activeReturn !== null ? (
                      <PercentCell value={Number(b.activeReturn)} locale={locale} />
                    ) : (
                      <span className="text-text-3">{t("noData")}</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function PercentCell({ value, locale }: { value: number; locale: string }) {
  return (
    <span className={cn(value >= 0 ? "text-success" : "text-destructive")}>
      {formatPercent(value, locale)}
    </span>
  );
}

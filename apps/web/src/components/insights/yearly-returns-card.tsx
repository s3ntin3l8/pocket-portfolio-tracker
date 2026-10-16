"use client";

import { signToneClass } from "@/lib/tone";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartTooltipPanel, type ChartTooltipRow } from "@/components/ui/chart-tooltip-panel";
import { formatPercent } from "@/lib/utils";
import { benchmarkLabel } from "@/lib/benchmark-labels";
import type { BenchmarkSymbolEntry, YearlyReturnRow } from "@portfolio/api-client";
import { useReducedMotion } from "@/lib/use-reduced-motion";

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
  const reducedMotion = useReducedMotion();
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
      <Card className="rounded-lg bg-card p-4 shadow-card">
        <p className="text-xs font-semibold text-text-2">{t("title")}</p>
        <p className="mt-2 text-xs text-text-2">{t("insufficientData")}</p>
      </Card>
    );
  }

  const subtitle = t("subtitle", {
    currency,
    benchmarks: symbols.map((s) => s.displayName || benchmarkLabel(s.symbol)).join(" · "),
  });

  return (
    <Card className="rounded-lg bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-text-2">{t("title")}</p>
          <p className="mt-0.5 truncate text-micro text-text-2">{subtitle}</p>
        </div>
      </div>

      <div className="mt-3 h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 10, fill: "var(--color-text-2)" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--color-text-2)" }}
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
            <Bar
              isAnimationActive={!reducedMotion}
              dataKey="portfolio"
              fill={CHART_PALETTE[0]}
              radius={[3, 3, 0, 0]}
            />
            {benchmarkColumnKeys.map((sym, i) => (
              <Bar
                isAnimationActive={!reducedMotion}
                key={sym}
                dataKey={sym}
                fill={CHART_PALETTE[(i + 1) % CHART_PALETTE.length]}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro font-semibold text-text-2">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-xs" style={{ background: CHART_PALETTE[0] }} />
          Portfolio
        </span>
        {benchmarkColumnKeys.map((sym, i) => (
          <span key={sym} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-xs"
              style={{ background: CHART_PALETTE[(i + 1) % CHART_PALETTE.length] }}
            />
            {benchmarkLabels[sym]}
          </span>
        ))}
      </div>

      <div className="mt-3">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-left h-auto px-2 py-1.5 first:pl-2 last:pr-2">
                {t("headerYear")}
              </TableHead>
              <TableHead className="text-right h-auto px-2 py-1.5 first:pl-2 last:pr-2">
                {t("headerPortfolioTwr")}
              </TableHead>
              <TableHead className="text-right h-auto px-2 py-1.5 first:pl-2 last:pr-2">
                {t("headerPortfolioXirr")}
              </TableHead>
              {symbols.map((s) => (
                <TableHead
                  key={s.symbol}
                  className="text-right h-auto px-2 py-1.5 first:pl-2 last:pr-2"
                >
                  {s.displayName || benchmarkLabel(s.symbol)}
                </TableHead>
              ))}
              {symbols.map((s) => (
                <TableHead
                  key={`act-${s.symbol}`}
                  className="h-auto px-2 py-1.5 text-right first:pl-2 last:pr-2"
                >
                  {t("headerActiveReturn", { symbol: s.displayName || benchmarkLabel(s.symbol) })}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.year} className="border-border/50 last:border-0">
                <TableCell className="px-2 py-1.5 first:pl-2 last:pr-2 text-left text-xs font-medium text-text-2">
                  {r.year}
                  {r.isCurrentYear && (
                    <span className="ml-1 text-micro text-text-2">· {t("ytdLabel")}</span>
                  )}
                </TableCell>
                <TableCell className="tabular px-2 py-1.5 first:pl-2 last:pr-2 text-right text-xs">
                  {r.portfolioTwr !== null ? (
                    <PercentCell value={Number(r.portfolioTwr)} locale={locale} />
                  ) : (
                    <span className="text-text-2">{t("noData")}</span>
                  )}
                </TableCell>
                <TableCell className="tabular px-2 py-1.5 first:pl-2 last:pr-2 text-right text-xs">
                  {r.portfolioXirr !== null ? (
                    <PercentCell value={Number(r.portfolioXirr)} locale={locale} />
                  ) : (
                    <span className="text-text-2">{t("noData")}</span>
                  )}
                </TableCell>
                {r.benchmarks.map((b) => (
                  <TableCell
                    key={b.symbol}
                    className="tabular px-2 py-1.5 first:pl-2 last:pr-2 text-right text-xs"
                  >
                    {b.twr !== null ? (
                      <PercentCell value={Number(b.twr)} locale={locale} />
                    ) : (
                      <span className="text-text-2">{t("noData")}</span>
                    )}
                  </TableCell>
                ))}
                {r.benchmarks.map((b) => (
                  <TableCell
                    key={`act-${b.symbol}`}
                    className="tabular px-2 py-1.5 text-right text-xs first:pl-2 last:pr-2"
                  >
                    {b.activeReturn !== null ? (
                      <PercentCell value={Number(b.activeReturn)} locale={locale} />
                    ) : (
                      <span className="text-text-2">{t("noData")}</span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function PercentCell({ value, locale }: { value: number; locale: string }) {
  return <span className={signToneClass(value)}>{formatPercent(value, locale)}</span>;
}

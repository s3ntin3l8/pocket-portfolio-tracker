import { deltaToneOf, signToneClass, toneBgClass, toneOf } from "@/lib/tone";
import { DataState } from "@/components/data-state";
import { retryAfterOf } from "@/lib/data-status";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { TABLE_LABEL, TABLE_VALUE_STRONG } from "@/components/ui/table";
import { TradesTable } from "@/components/trades-table";
import { TradeMethodToggle } from "@/components/trade-method-toggle";
import { TradesPageCommands } from "@/components/trades-page-commands";
import { loadTrades, loadPreferences } from "@/lib/server-api";
import {
  formatMoney,
  formatPercent,
  formatPercentUnsigned,
  formatSignedMoney,
  cn,
} from "@/lib/utils";
import { PageRail, PageWithRail } from "@/components/page-with-rail";

type Method = "average" | "fifo";

const TIMING = typeof process !== "undefined" && process.env?.TIMING_ENABLED === "true";

export default async function TradesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ method?: string }>;
}) {
  // eslint-disable-next-line react-hooks/purity
  const t0 = TIMING ? performance.now() : 0;
  const { locale } = await params;
  const { method: methodParam } = await searchParams;
  const method: Method = methodParam === "fifo" ? "fifo" : "average";
  setRequestLocale(locale);
  const t = await getTranslations("Trades");
  const te = await getTranslations("Empty");

  // Cost basis is a single global preference (Settings → Investing) — there was
  // never a visible toggle here (only `?costBasis=` reachable by hand-editing the
  // URL), so switching the source has near-zero UX cost.
  // Kick off loadPreferences as early as possible; loadTrades needs the result
  // (costBasis), so it can't be truly parallelized, but the prefs fetch starts
  // while translations / params resolve.
  const prefsPromise = loadPreferences();

  const prefs = await prefsPromise;
  const costBasis = prefs?.costBasisMode ?? "purchase_price";

  const result = await loadTrades(method, costBasis);

  if (TIMING) {
    // eslint-disable-next-line react-hooks/purity
    const durationMs = performance.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: `[timing] TradesPage data fetch`,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  }

  const log = result.status === "ok" ? result.data : null;
  const currency = log?.displayCurrency ?? "IDR";
  const money = (n: string | number) => formatMoney(Number(n), currency, locale);

  const Heading = (
    <>
      <PageHeader
        backHref="/reports"
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          log ? (
            <>
              <TradeMethodToggle
                current={method}
                labelAverage={t("methodAverage")}
                labelFifo={t("methodFifo")}
                aria-label={t("methodGroup")}
              />
              <TradesPageCommands current={method} />
            </>
          ) : undefined
        }
      />
    </>
  );

  if (result.status !== "ok" && result.status !== "empty") {
    return (
      <div className="space-y-5">
        {Heading}
        <DataState status={result.status} retryAfter={retryAfterOf(result)} />
      </div>
    );
  }

  if (!log || log.trades.length === 0) {
    return (
      <div className="space-y-5">
        {Heading}
        <EmptyState
          icon={ScrollText}
          title={result.status === "empty" ? te("noPortfolioTitle") : t("emptyTitle")}
          description={result.status === "empty" ? te("noPortfolioBody") : t("emptyBody")}
        />
      </div>
    );
  }

  const totalReturn = Number(log.totalReturn);
  const returnTone = deltaToneOf(totalReturn);
  // Capital-weighted return across all trades (same formula as per-row totalReturnPct).
  const totalInvested = log.trades.reduce((s, tr) => s + Number(tr.invested), 0);
  const totalReturnPct = totalInvested > 0 ? totalReturn / totalInvested : null;

  // Win/loss split — closed trades only (an open position has no realized outcome yet).
  const closedTrades = log.trades.filter((tr) => tr.status === "closed");
  const winners = closedTrades.filter((tr) => Number(tr.totalReturn) > 0);
  const losers = closedTrades.filter((tr) => Number(tr.totalReturn) < 0);
  const winnersTotal = winners.reduce((s, tr) => s + Number(tr.totalReturn), 0);
  const losersTotal = losers.reduce((s, tr) => s + Number(tr.totalReturn), 0);
  const winLossDenom = winnersTotal + Math.abs(losersTotal);
  const winPct = winLossDenom > 0 ? (winnersTotal / winLossDenom) * 100 : 0;

  // Bar scales use the REAL largest magnitude (no floor): the largest bar fills the plot
  // area and a year without an amount renders NO bar at all. Both charts are drawn against
  // a ZERO baseline, so a loss year grows DOWNWARD instead of being drawn as an upward bar
  // of the same height as an equal gain — the sign is readable without relying on colour.
  const realizedAmounts = log.realizedByYear.map((r) => Number(r.amount));
  const realizedMaxAbs = Math.max(0, ...realizedAmounts.map((a) => Math.abs(a)));
  const realizedHasPositive = realizedAmounts.some((a) => a > 0);
  const realizedHasNegative = realizedAmounts.some((a) => a < 0);
  const dividendAmounts = log.dividendsByYear.map((d) => Number(d.amount));
  const dividendMaxAbs = Math.max(0, ...dividendAmounts.map((a) => Math.abs(a)));
  const dividendHasPositive = dividendAmounts.some((a) => a > 0);
  const dividendHasNegative = dividendAmounts.some((a) => a < 0);

  return (
    <div className="space-y-5">
      {Heading}

      <PageWithRail>
        {/* ── Main column: trades table + tax lens ── */}
        <div className="min-w-0 space-y-5">
          <TradesTable trades={log.trades} currency={currency} />

          {/* ── Tax lens ── */}
          <div className="grid gap-4 @lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>{t("realizedByYearChartTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                {log.realizedByYear.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noRealized")}</p>
                ) : (
                  <YearBars
                    testId="realized-bar"
                    rows={log.realizedByYear.map((r) => ({
                      year: r.year,
                      amount: Number(r.amount),
                    }))}
                    maxAbs={realizedMaxAbs}
                    hasPositive={realizedHasPositive}
                    hasNegative={realizedHasNegative}
                    formatValue={(amount) => formatSignedMoney(amount, currency, locale)}
                    valueClassName={(amount) => signToneClass(amount)}
                    barClassName={(amount) => toneBgClass(toneOf(amount))}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle>{t("dividendsByYear")}</CardTitle>
              </CardHeader>
              <CardContent>
                {log.dividendsByYear.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("noDividends")}</p>
                ) : (
                  <YearBars
                    testId="dividend-bar"
                    rows={log.dividendsByYear.map((d) => ({
                      year: d.year,
                      amount: Number(d.amount),
                    }))}
                    maxAbs={dividendMaxAbs}
                    hasPositive={dividendHasPositive}
                    hasNegative={dividendHasNegative}
                    formatValue={(amount) => money(amount)}
                    barClassName={(amount) => toneBgClass(toneOf(amount))}
                  />
                )}
              </CardContent>
            </Card>

            {log.bonusesByYear.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle>{t("bonusesByYear")}</CardTitle>
                  <p className="text-xs font-medium text-text-2">{t("bonusesNote")}</p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {log.bonusesByYear.map((b) => (
                      <div key={b.year} className="flex justify-between">
                        <span className={TABLE_LABEL}>{b.year}</span>
                        <span className={cn(TABLE_VALUE_STRONG, "text-success")}>
                          {money(b.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <p className="text-xs text-muted-foreground">{t("taxDisclaimer")}</p>
        </div>

        {/* ── Sidebar: KPI cards + charts (sticky on wide containers) ── */}
        <PageRail className="space-y-5">
          <div className="grid grid-cols-2 gap-2.5 sm:gap-4 @xl:grid-cols-1">
            <StatCard
              label={t("totalReturn")}
              value={formatSignedMoney(totalReturn, currency, locale)}
              delta={totalReturnPct !== null ? formatPercent(totalReturnPct, locale) : undefined}
              deltaTone={returnTone}
            />
            <StatCard label={t("totalRealized")} value={money(log.totalRealized)} />
            <StatCard label={t("totalDividends")} value={money(log.totalDividends)} />
            <Card className="px-5 py-4">
              <p className="text-xs font-semibold text-muted-foreground">{t("winLossTitle")}</p>
              <p className="tabular mt-1 text-2xl font-bold">
                {log.winRate === null ? "—" : formatPercentUnsigned(log.winRate, locale)}
              </p>
              <p className="mt-0.5 text-micro font-medium text-text-2">
                {t("winLossSubtitle", { winners: winners.length, total: closedTrades.length })}
              </p>
              <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-success" style={{ width: `${winPct}%` }} />
                <div className="h-full bg-destructive" style={{ width: `${100 - winPct}%` }} />
              </div>
            </Card>
          </div>
        </PageRail>
      </PageWithRail>
    </div>
  );
}

/**
 * A year-by-year bar chart drawn against a ZERO baseline.
 *
 * Each column shows the year's amount on top, the bar in the middle and the year
 * underneath. The bar's height is a share of the REAL largest magnitude (`maxAbs`, no
 * floor), so the biggest bar fills the plot area and a year without an amount renders NO
 * bar at all. A negative amount grows DOWNWARD from the baseline instead of being drawn
 * as an upward bar of the same height as an equal gain — the sign is readable without
 * relying on the colour alone.
 *
 * With gains and losses side by side the baseline sits in the middle of the plot area and
 * both halves share ONE scale (the same number of pixels per currency unit); with only
 * gains (or only losses) the baseline sits at the matching edge and that side gets the
 * whole plot area.
 */
function YearBars({
  rows,
  maxAbs,
  hasPositive,
  hasNegative,
  formatValue,
  valueClassName,
  barClassName,
  testId,
}: {
  rows: { year: number; amount: number }[];
  /** The real largest magnitude across `rows` (0 when there is nothing to scale). */
  maxAbs: number;
  hasPositive: boolean;
  hasNegative: boolean;
  formatValue: (amount: number) => string;
  /** Extra classes for the amount label (tone). */
  valueClassName?: (amount: number) => string;
  /** Classes for the bar itself (tone). */
  barClassName: (amount: number) => string;
  /** Test hook: the rendered bars carry this `data-testid` plus year/direction. */
  testId: string;
}) {
  const baselinePct = hasPositive && hasNegative ? 50 : hasNegative ? 100 : 0;
  return (
    <div className="flex items-end justify-between gap-2 overflow-hidden" style={{ height: 140 }}>
      {rows.map((row) => {
        const amount = row.amount;
        // The share of the plot area this bar occupies — never negative, so a negative
        // amount can never reach the `height` style as an invalid (negative) percentage.
        const space = amount > 0 ? (hasNegative ? 50 : 100) : hasPositive ? 50 : 100;
        const pct = amount === 0 || maxAbs <= 0 ? 0 : (Math.abs(amount) / maxAbs) * space;
        const direction = amount > 0 ? "up" : amount < 0 ? "down" : "none";
        return (
          <div key={row.year} className="flex h-full flex-1 flex-col items-center gap-1.5">
            <span className={cn("tabular text-xs font-bold", valueClassName?.(amount))}>
              {formatValue(amount)}
            </span>
            {/* Plot area: the zero baseline, with gains above it and losses below it. */}
            <div className="relative w-full flex-1">
              <div
                aria-hidden
                className="absolute inset-x-0 border-t border-border"
                style={{ bottom: `${baselinePct}%` }}
              />
              {direction !== "none" && (
                <div
                  data-testid={testId}
                  data-year={String(row.year)}
                  data-direction={direction}
                  data-amount={String(amount)}
                  className={cn(
                    "absolute inset-x-0 mx-auto w-full max-w-10",
                    direction === "up" ? "rounded-t-xs" : "rounded-b-xs",
                    barClassName(amount),
                  )}
                  style={
                    direction === "up"
                      ? { bottom: `${baselinePct}%`, height: `${pct}%` }
                      : { top: `${100 - baselinePct}%`, height: `${pct}%` }
                  }
                />
              )}
            </div>
            <span className="text-xs text-muted-foreground">{row.year}</span>
          </div>
        );
      })}
    </div>
  );
}

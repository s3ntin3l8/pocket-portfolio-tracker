import { DataState } from "@/components/data-state";
import { retryAfterOf } from "@/lib/data-status";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Scale } from "lucide-react";
import { RebalancingCard } from "@/components/insights/rebalancing-card";
import { BestWorstCard } from "@/components/insights/best-worst-card";
import { DrawdownCard } from "@/components/insights/drawdown-card";
import { VolatilityCard } from "@/components/insights/volatility-card";
import { StreaksCard } from "@/components/insights/streaks-card";
import { BenchmarkCard } from "@/components/insights/benchmark-card";
import { ConcentrationTrendCard } from "@/components/insights/concentration-trend-card";
import { CompositionCard } from "@/components/insights/composition-card";
import { DiversificationCard } from "@/components/insights/diversification-card";
import { LazyYearlyReturnsCard as YearlyReturnsCard } from "@/components/charts/lazy";
import {
  loadNetWorth,
  loadNetWorthHistory,
  loadHoldings,
  loadPreferences,
  loadInsights,
  loadContributions,
  getSelectedPortfolioId,
} from "@/lib/server-api";
import { bestAndWorst, periodToMover } from "@/lib/movers";
import { cn, formatPercent, formatPercentPoints } from "@/lib/utils";
import { signToneClass } from "@/lib/tone";
import { Card, CardLabel } from "@/components/ui/card";
import { isIntradayPoint } from "@portfolio/api-client";
import { PageHeader } from "@/components/page-header";
import { PageRail, PageWithRail } from "@/components/page-with-rail";

const TIMING = typeof process !== "undefined" && process.env?.TIMING_ENABLED === "true";

export default async function InsightsPage({ params }: { params: Promise<{ locale: string }> }) {
  // eslint-disable-next-line react-hooks/purity
  const t0 = TIMING ? performance.now() : 0;
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Insights");
  const td = await getTranslations("Dashboard");
  const tc = await getTranslations("AssetClass");
  const te = await getTranslations("Empty");

  const prefsPromise = loadPreferences();
  const historyPromise = loadNetWorthHistory("all");
  const holdingsPromise = loadHoldings();
  const selectedIdPromise = getSelectedPortfolioId();
  const insightsPromise = loadInsights("all");
  const contributionsPromise = loadContributions();

  const prefs = await prefsPromise;
  const costBasis = prefs?.costBasisMode ?? "purchase_price";

  const [result, history, holdingsView, selectedId, insights, contributions] = await Promise.all([
    loadNetWorth(costBasis),
    historyPromise,
    holdingsPromise,
    selectedIdPromise,
    insightsPromise,
    contributionsPromise,
  ]);

  if (TIMING) {
    // eslint-disable-next-line react-hooks/purity
    const durationMs = performance.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: `[timing] InsightsPage data fetch`,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  }

  if (result.status !== "ok") {
    return (
      <div className="space-y-5">
        <PageHeader title={t("title")} />
        <DataState
          status={result.status}
          retryAfter={retryAfterOf(result)}
          icon={Scale}
          empty={{ title: te("noPortfolioTitle"), description: te("noPortfolioBody") }}
        />
      </div>
    );
  }

  const summary = result.data;
  const allocation = summary.allocation;

  const firstPoint = history.find((p) => !isIntradayPoint(p));
  const sinceYear = firstPoint
    ? Number((firstPoint as { date: string }).date.slice(0, 4))
    : new Date().getUTCFullYear();

  const filteredClasses = allocation?.byAssetClass.filter((s) => Number(s.value) > 0) ?? [];
  const assetClassSlices = filteredClasses.map((s) => ({
    key: s.key,
    label: s.key === "cash" ? tc("cash") : tc(s.key),
    actualPct: s.pct,
  }));
  const topClass =
    filteredClasses.length > 0 ? [...filteredClasses].sort((a, b) => b.pct - a.pct)[0] : null;

  const movers = bestAndWorst(
    holdingsView.status === "ok"
      ? holdingsView.holdings.filter((h) => Number(h.quantity) !== 0)
      : [],
  );

  const insightsData = insights.status === "ok" ? insights.data : null;

  return (
    <div className="space-y-5">
      <PageHeader title={t("title")} />

      <Card className="p-6">
        <CardLabel>{t("xirr.label")}</CardLabel>
        <p
          className={cn(
            "tabular mt-1 text-hero font-bold leading-none",
            signToneClass(summary.xirr),
          )}
        >
          {summary.xirr !== null ? formatPercent(summary.xirr, locale) : "—"}
        </p>
        <p className="mt-1 text-xs font-medium leading-[1.5] text-muted-foreground">
          {t("xirr.caption", { year: sinceYear })}
        </p>
        {summary.xirr !== null &&
          contributions.status === "ok" &&
          contributions.data.monthsElapsed < 12 && (
            <p className="mt-1 text-xs text-muted-foreground/80">{t("xirr.youngHint")}</p>
          )}
      </Card>

      <PageWithRail>
        {/* ── Sidebar: overview metrics. `railFirstOnMobile` keeps them near the top on
        mobile (right after the XIRR hero); `PageRail` moves them right on desktop and
        caps their height so the rail doesn't eat the viewport. ── */}
        <PageRail railFirstOnMobile className="space-y-3.5">
          {allocation && (
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-4">
                <CardLabel>{t("concentration.label")}</CardLabel>
                <p className="tabular mt-1 text-heading font-bold leading-none">
                  {formatPercentPoints(allocation.concentration.top1Pct, locale, 1)}
                </p>
                {topClass && (
                  <CardLabel className="mt-1">
                    {t("concentration.top", {
                      label: topClass.key === "cash" ? tc("cash") : tc(topClass.key),
                      tone: td(
                        allocation.concentration.label === "diversified"
                          ? "concentrationDiversified"
                          : allocation.concentration.label === "moderate"
                            ? "concentrationModerate"
                            : "concentrationConcentrated",
                      ).toLowerCase(),
                    })}
                  </CardLabel>
                )}
              </Card>

              <DiversificationCard allocation={allocation} classCount={assetClassSlices.length} />
            </div>
          )}

          {movers && (
            <BestWorstCard
              best={movers.best}
              worst={movers.worst}
              title={t("bestWorst.title")}
              timeframeLabel={t("bestWorst.timeframe")}
              bestLabel={t("bestWorst.best")}
              worstLabel={t("bestWorst.worst")}
              locale={locale}
            />
          )}

          {insightsData && (
            <BestWorstCard
              best={
                insightsData.bestWorstMonthly.best
                  ? periodToMover(insightsData.bestWorstMonthly.best)
                  : null
              }
              worst={
                insightsData.bestWorstMonthly.worst
                  ? periodToMover(insightsData.bestWorstMonthly.worst)
                  : null
              }
              title={t("bestWorst.monthlyTitle")}
              timeframeLabel={t("bestWorst.monthlyTimeframe")}
              bestLabel={t("bestWorst.best")}
              worstLabel={t("bestWorst.worst")}
              locale={locale}
              staleMessage={
                insightsData.bestWorstMonthly.reason === "stale_prices"
                  ? t("bestWorst.staleData")
                  : undefined
              }
            />
          )}

          {insightsData && (
            <BestWorstCard
              best={
                insightsData.bestWorstYearly.best
                  ? periodToMover(insightsData.bestWorstYearly.best)
                  : null
              }
              worst={
                insightsData.bestWorstYearly.worst
                  ? periodToMover(insightsData.bestWorstYearly.worst)
                  : null
              }
              title={t("bestWorst.yearlyTitle")}
              timeframeLabel={t("bestWorst.yearlyTimeframe")}
              bestLabel={t("bestWorst.best")}
              worstLabel={t("bestWorst.worst")}
              locale={locale}
              staleMessage={
                insightsData.bestWorstYearly.reason === "stale_prices"
                  ? t("bestWorst.staleData")
                  : undefined
              }
            />
          )}

          {insightsData && (
            <>
              <DrawdownCard drawdown={insightsData.drawdown} locale={locale} />
              <VolatilityCard volatility={insightsData.volatility} locale={locale} />
              <StreaksCard streaks={insightsData.streaks} locale={locale} />
              <BenchmarkCard
                benchmark={insightsData.benchmark ?? null}
                symbols={prefs?.benchmarkSymbols ?? []}
                locale={locale}
              />
            </>
          )}
        </PageRail>

        {/* ── Main column: detailed analysis ── */}
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 @lg:grid-cols-2">
            <RebalancingCard
              portfolioId={selectedId ?? undefined}
              slices={assetClassSlices}
              drift={summary.drift?.asset_class}
            />

            {allocation && (
              <CompositionCard
                allocation={allocation}
                currency={summary.displayCurrency}
                holdings={holdingsView.status === "ok" ? holdingsView.holdings : undefined}
                portfolioId={selectedId ?? undefined}
              />
            )}
          </div>

          {insightsData && insightsData.yearlyReturns.length > 0 && (
            <YearlyReturnsCard
              rows={insightsData.yearlyReturns}
              symbols={prefs?.benchmarkSymbols ?? []}
              currency={summary.displayCurrency}
              locale={locale}
            />
          )}

          {insightsData && insightsData.concentrationTrend.length > 0 && (
            <ConcentrationTrendCard trend={insightsData.concentrationTrend} locale={locale} />
          )}
        </div>
      </PageWithRail>
    </div>
  );
}

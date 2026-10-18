import { deltaToneOf } from "@/lib/tone";
import { Decimal } from "decimal.js";
import { DataState } from "@/components/data-state";
import { retryAfterOf } from "@/lib/data-status";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PiggyBank } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { LazyContributionsChart as ContributionsChart } from "@/components/charts/lazy";
import { ForecastPanel } from "@/components/savings/forecast-panel";
import { SparplanSection } from "@/components/savings/sparplan-section";
import { PageHeader } from "@/components/page-header";
import { CashOnHandCard } from "@/components/savings/cash-on-hand-card";
import { loadContributions, loadSparplan, loadHoldings, loadNetWorth } from "@/lib/server-api";
import { GainFigure } from "@/components/gain-figure";
import { toneOf } from "@/lib/tone";
import { GainExplainer } from "@/components/gain-explainer";
import { formatMoney, formatPercent, formatSignedMoney } from "@/lib/utils";
import { PageRail, PageWithRail } from "@/components/page-with-rail";

const TIMING = typeof process !== "undefined" && process.env?.TIMING_ENABLED === "true";

export default async function SavingsPage({ params }: { params: Promise<{ locale: string }> }) {
  // eslint-disable-next-line react-hooks/purity
  const t0 = TIMING ? performance.now() : 0;
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Savings");

  // Holder scope is now global (cookie-based via the portfolio switcher).
  // All three loaders are independent — fire them in parallel.
  const [result, sparplanResult, holdingsResult, netWorthResult] = await Promise.all([
    loadContributions(),
    loadSparplan(),
    loadHoldings(),
    loadNetWorth(),
  ]);

  if (TIMING) {
    // eslint-disable-next-line react-hooks/purity
    const durationMs = performance.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: `[timing] SavingsPage data fetch`,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  }

  const heading = (
    <>
      <PageHeader backHref="/reports" title={t("title")} subtitle={t("subtitle")} />
    </>
  );

  if (result.status !== "ok" || Number(result.data.totalContributed) === 0) {
    return (
      <div className="space-y-5">
        {heading}
        <DataState
          status={result.status === "ok" ? "empty" : result.status}
          retryAfter={retryAfterOf(result)}
          icon={PiggyBank}
          empty={{ title: t("emptyTitle"), description: t("emptyBody") }}
        />
      </div>
    );
  }

  const c = result.data;
  const currency = c.displayCurrency;
  const m = (n: number) => formatMoney(n, currency, locale);
  // Gain vs NET CONTRIBUTED (the savings basis) — labelled as such, and explained by the same
  // sheet the Holdings rail opens (audit G2). `gain` is the scope's single GainSummary.
  const gain = netWorthResult.status === "ok" ? netWorthResult.data.gain : undefined;
  // From the shared payload when available, so this figure and the explainer cannot disagree;
  // the contributions response (same value/net pair) is only the fallback for an older API.
  const gainAmount = gain
    ? new Decimal(gain.value).minus(gain.netContributed).toNumber()
    : new Decimal(c.currentValue).minus(c.netContributed).toNumber();

  return (
    <div className="space-y-5">
      {heading}

      <PageWithRail>
        {/* ── Main column: chart + plans + forecast + cash ── */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              {/* Reference: title/subtitle on the left, the chart legend on the right of the same row. */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-base">{t("contributionsOverTime")}</CardTitle>
                  {c.dailySeries.length > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("contributionsSubtitle", {
                        date: new Intl.DateTimeFormat(locale, {
                          month: "short",
                          year: "numeric",
                        }).format(new Date(c.dailySeries[0].date)),
                      })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3.5 text-micro font-semibold text-text-2">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-xs bg-success" />
                    {t("chartValue")}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-0 w-3.5 border-t-2 border-dashed border-text-2" />
                    {t("chartContributions")}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ContributionsChart
                series={c.series}
                dailySeries={c.dailySeries}
                valueHistory={result.valueHistory}
                currency={currency}
              />
            </CardContent>
          </Card>

          {/* Plans + forecast side by side on desktop (reference: 2-col grid). */}
          <div className="grid gap-6 @lg:grid-cols-2">
            {sparplanResult.status === "ok" && sparplanResult.data.plans.length > 0 && (
              <SparplanSection
                data={sparplanResult.data}
                currency={currency}
                locale={locale}
                portfolioId={sparplanResult.portfolioId ?? undefined}
                drift={sparplanResult.data.drift}
                contributionSplit={sparplanResult.data.contributionSplit}
              />
            )}

            <ForecastPanel
              currentValue={c.currentValue}
              netContributed={c.netContributed}
              monthlyAverage={c.monthlyAverage}
              seedAnnualReturn={c.seedAnnualReturn}
              currency={currency}
              birthYear={c.birthYear}
              portfolioType={c.portfolioType}
              retirementAge={c.retirementAge}
            />
          </div>

          {holdingsResult.status === "ok" && holdingsResult.cashTracked && (
            <CashOnHandCard cash={holdingsResult.cash} locale={locale} />
          )}
        </div>

        {/* ── Sidebar: stat cards (sticky on wide containers) ── */}
        <PageRail>
          <div className="grid grid-cols-1 space-y-2.5 sm:space-y-4">
            <StatCard label={t("totalContributed")} value={m(Number(c.netContributed))} />
            <StatCard
              label={t("monthlyAverage")}
              value={m(Number(c.monthlyAverage))}
              delta={t("monthsElapsed", { count: c.monthsElapsed })}
              deltaTone="neutral"
            />
            <StatCard label={t("currentValue")} value={m(Number(c.currentValue))} />
            <Card>
              <CardContent className="px-3.5 py-3.5 sm:px-[18px] sm:py-4">
                <p className="text-micro font-semibold text-text-2 sm:text-xs">{t("gainLabel")}</p>
                <GainFigure
                  amount={formatSignedMoney(gainAmount, currency, locale)}
                  pct={c.simpleGainPct !== null ? formatPercent(c.simpleGainPct, locale) : null}
                  tone={toneOf(gainAmount)}
                  basis="contributed"
                  className="mt-1"
                />
                {gain && (
                  <div className="mt-1.5">
                    <GainExplainer gain={gain} />
                  </div>
                )}
              </CardContent>
            </Card>
            {/* Gross-contributed basis (see reports-cards.tsx), named in the label. `typeof`
                rather than `!== null`: an API without the field must hide the card, not
                format "NaN%". */}
            {typeof c.totalReturnPct === "number" && (
              <StatCard
                label={t("totalReturn")}
                value={formatPercent(c.totalReturnPct, locale)}
                delta={t("totalReturnHint")}
                deltaTone={deltaToneOf(c.totalReturnPct)}
              />
            )}
            <StatCard
              label={t("xirr")}
              value={c.xirr !== null ? formatPercent(c.xirr, locale) : "—"}
              // Under a year of data, XIRR extrapolates one-time/early gains (e.g. a starting
              // bonus) into an apparent annual rate — flag it so it isn't read as a run-rate.
              delta={c.xirr !== null && c.monthsElapsed < 12 ? t("xirrYoungHint") : undefined}
              deltaTone="neutral"
            />
          </div>
        </PageRail>
      </PageWithRail>
    </div>
  );
}

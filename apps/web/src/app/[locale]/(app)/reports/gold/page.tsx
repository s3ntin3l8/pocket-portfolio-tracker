import { Gem } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DataState } from "@/components/data-state";
import { FxMissingBanner } from "@/components/fx-missing-banner";
import { GainFigure, toneOf } from "@/components/gain-figure";
import { PageHeaderSetter } from "@/components/page-header";
import { GoldHoldingsTable } from "@/components/reports/gold/gold-holdings-table";
import { GoldPlanCard } from "@/components/reports/gold/gold-plan-card";
import { ReportHeader } from "@/components/report-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { retryAfterOf } from "@/lib/data-status";
import { collectFxMissing } from "@/lib/fx-missing";
import { loadGoldReport } from "@/lib/server-api";
import { formatMoney, formatPercent, formatQuantity, formatSignedMoney } from "@/lib/utils";

export default async function GoldReportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("GoldReport");

  const result = await loadGoldReport();

  const heading = (
    <>
      <PageHeaderSetter title={t("title")} backHref="/reports" />
      <ReportHeader title={t("title")} subtitle={t("subtitle")} />
    </>
  );

  if (result.status !== "ok") {
    return (
      <div className="space-y-5">
        {heading}
        <DataState
          status={result.status}
          retryAfter={retryAfterOf(result)}
          icon={Gem}
          empty={{ title: t("emptyTitle"), description: t("emptyBody") }}
        />
      </div>
    );
  }

  if (result.data.holdings.length === 0 && result.data.plans.length === 0) {
    return (
      <div className="space-y-5">
        {heading}
        <DataState
          status="empty"
          icon={Gem}
          empty={{ title: t("emptyTitle"), description: t("emptyBody") }}
        />
      </div>
    );
  }

  const { data } = result;
  const currency = data.displayCurrency;
  const m = (n: number | string) => formatMoney(Number(n), currency, locale);
  const unrealized = Number(data.totals.unrealized);
  const measuredCost = Number(data.totals.measuredCost);
  const gainPct = measuredCost > 0 ? unrealized / measuredCost : null;
  const openPlans = data.plans.filter((p) => !p.completed);
  const outstanding = Object.entries(data.totals.outstandingByCurrency)
    .filter(([, v]) => Number(v) !== 0)
    .map(([c, v]) => formatMoney(Number(v), c, locale))
    .join(" · ");
  const nameByInstrument = new Map(data.holdings.map((h) => [h.instrumentId, h.name]));

  return (
    <div className="space-y-5">
      {heading}
      <FxMissingBanner currencies={collectFxMissing(data)} />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 @xl:grid-cols-4">
        <StatCard
          label={t("statGrams")}
          value={formatQuantity(Number(data.totals.grams), "grams", locale)}
        />
        <StatCard label={t("statValue")} value={m(data.totals.value)} basis={t("statValueBasis")} />
        {/* Spans the row on narrow containers: amount + percent need the width. */}
        <Card className="col-span-2 @xl:col-span-1">
          <CardContent className="px-3.5 py-3.5 sm:px-[18px] sm:py-4">
            <p className="text-micro font-semibold text-text-2 sm:text-xs">{t("statGain")}</p>
            {measuredCost > 0 ? (
              <GainFigure
                amount={formatSignedMoney(unrealized, currency, locale)}
                pct={gainPct !== null ? formatPercent(gainPct, locale) : null}
                tone={toneOf(unrealized)}
                basis="cost"
                className="mt-1"
              />
            ) : (
              <p className="mt-1 text-xl font-extrabold text-text-2">—</p>
            )}
          </CardContent>
        </Card>
        <StatCard
          label={t("statOutstanding")}
          value={outstanding || "—"}
          caption={t("statOutstandingCaption", { count: openPlans.length })}
          className="col-span-2 @xl:col-span-1"
        />
      </div>

      {data.plans.length > 0 && (
        <section className="space-y-3" aria-labelledby="gold-plans">
          <div>
            <h2 id="gold-plans" className="text-base font-semibold">
              {t("plansTitle")}
            </h2>
            <p className="text-xs text-text-2">{t("plansSubtitle")}</p>
          </div>
          <div className="grid gap-4 @3xl:grid-cols-2">
            {data.plans.map((p) => (
              <GoldPlanCard
                key={p.loanId}
                plan={p}
                title={nameByInstrument.get(p.instrumentId) ?? null}
                displayCurrency={currency}
                locale={locale}
              />
            ))}
          </div>
        </section>
      )}

      {data.holdings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("holdingsTitle")}</CardTitle>
            <p className="text-xs text-text-2">{t("holdingsSubtitle")}</p>
          </CardHeader>
          <CardContent>
            <GoldHoldingsTable
              holdings={data.holdings}
              displayCurrency={currency}
              locale={locale}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { getTranslations, setRequestLocale } from "next-intl/server";
import { Receipt, TrendingUp, Landmark, CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DistributionCard,
  HarvestRow,
  HarvestSummaryNote,
  type TaxTranslator,
} from "@/components/tax/tax-cards";
import { loadNetworthTax } from "@/lib/server-api";
import { formatMoney } from "@/lib/utils";
import type { TaxSummaryHolder } from "@portfolio/api-client";

export default async function TaxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { locale } = await params;
  const { year: yearParam } = await searchParams;
  const year = yearParam ? parseInt(yearParam, 10) : undefined;
  setRequestLocale(locale);
  const t = await getTranslations("Tax");

  const holders = await loadNetworthTax(year);

  const Heading = (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
    </div>
  );

  if (holders.length === 0) {
    return (
      <div className="space-y-6">
        {Heading}
        <EmptyState
          icon={Receipt}
          title={t("empty.title")}
          description={t("empty.description")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {Heading}
      {holders.map((entry) => (
        <TaxHolderSection key={entry.holder.id} entry={entry} locale={locale} t={t} />
      ))}
    </div>
  );
}

function TaxHolderSection({
  entry,
  locale,
  t,
}: {
  entry: TaxSummaryHolder;
  locale: string;
  t: TaxTranslator;
}) {
  const { holder, year, currency, allowanceUsage: u, harvestSuggestions, distribution } = entry;
  const money = (n: string | number) => formatMoney(Number(n), currency, locale);
  const pct = parseFloat(u.remaining) / parseFloat(u.allowanceAnnual);
  const usedPct = Math.round((1 - Math.max(0, Math.min(1, pct))) * 100);
  const hasForecast = Number(u.forecastIncomeRestOfYear) > 0;

  return (
    <section className="space-y-4">
      {/* Holder header */}
      <div className="flex items-center gap-2">
        <Landmark className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {holder.name} — {year}
        </h2>
      </div>

      {/* Realized allowance summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={t("allowance.annual")}
          value={money(u.allowanceAnnual)}
          delta={t("allowance.annualDesc")}
        />
        <StatCard
          label={t("allowance.used")}
          value={money(u.usedYtd)}
          delta={t("allowance.usedDesc")}
        />
        <StatCard
          label={t("allowance.remaining")}
          value={money(u.remaining)}
          delta={`${t("allowance.taxSaving")}: ${money(u.taxSavingAvailable)}`}
        />
      </div>

      {/* FSA distribution roll-up (only when we have distribution context) */}
      {distribution && (
        <DistributionCard distribution={distribution} money={money} t={t} />
      )}

      {/* Progress bar */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("allowance.usedPct", { pct: usedPct })}</span>
            <span className="text-muted-foreground">
              {money(u.realizedGainsAdjusted)} {t("allowance.gains")} +{" "}
              {money(u.incomeYtd)} {t("allowance.income")}
            </span>
          </div>
          {/* Simple inline progress bar (no external component needed) */}
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.min(100, usedPct)}%` }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Rest-of-year forecast block (only when there's a non-zero projection) */}
      {hasForecast && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="size-4" />
              {t("forecast.label")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">{t("forecast.disclaimer")}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard
                label={t("forecast.label")}
                value={money(u.forecastIncomeRestOfYear)}
                delta={t("forecast.labelDesc")}
              />
              <StatCard
                label={t("forecast.projectedUsed")}
                value={money(u.projectedUsedFullYear)}
                delta={t("forecast.projectedUsedDesc")}
              />
              <StatCard
                label={t("forecast.projectedRemaining")}
                value={money(u.projectedRemaining)}
                delta={`${t("forecast.projectedTaxSaving")}: ${money(u.projectedTaxSavingAvailable)}`}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Harvest suggestions (sized against projected remaining when forecast is available) */}
      {harvestSuggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="size-4" />
              {t("harvest.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              {hasForecast ? t("harvest.subtitle") : t("harvest.subtitleNoForecast")}
            </p>
            <div className="divide-y">
              {harvestSuggestions.map((s) => (
                <HarvestRow key={s.instrumentId} s={s} money={money} t={t} />
              ))}
            </div>
            <HarvestSummaryNote suggestions={harvestSuggestions} money={money} t={t} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}

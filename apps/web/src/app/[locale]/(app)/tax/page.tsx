import { DataState } from "@/components/data-state";
import { FxMissingBanner } from "@/components/fx-missing-banner";
import { collectFxMissing } from "@/lib/fx-missing";
import { retryAfterOf } from "@/lib/data-status";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Receipt, TrendingUp, Landmark, CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EstimatedTaxHero,
  AllowanceSummaryBoxes,
  DistributionCard,
  HarvestRow,
  HarvestSummaryNote,
  VorabpauschaleRow,
  CoverageCard,
  type TaxTranslator,
} from "@/components/tax/tax-cards";
import { PeriodSelect } from "@/components/period-select";
import { TaxPageCommands } from "@/components/tax/tax-page-commands";
import { RegimeIndicator } from "@/components/tax/regime-indicator";
import { LossCarryforwardEditor } from "@/components/tax/loss-carryforward-editor";
import { loadNetworthTaxResult, loadPreferences, loadTaxYearDetail } from "@/lib/server-api";
import { formatMoney, formatMoneyCompact, formatMoneyWhole } from "@/lib/utils";
import type { TaxSummaryHolderWithCarryForward } from "@/lib/server-api/_shared";
import { harvestSummary } from "@portfolio/core";
import { TaxHolderDetailDE, TaxHolderSectionId } from "./tax-detail-section";
import { tint } from "@/lib/tint";
import { PageRail, PageWithRail } from "@/components/page-with-rail";

const TIMING = typeof process !== "undefined" && process.env?.TIMING_ENABLED === "true";

export default async function TaxPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  // eslint-disable-next-line react-hooks/purity
  const t0 = TIMING ? performance.now() : 0;
  const { locale } = await params;
  const { year: yearParam } = await searchParams;
  // `?year=` is URL state; anything but a 4-digit year is ignored (current year).
  const year = yearParam && /^\d{4}$/.test(yearParam) ? parseInt(yearParam, 10) : undefined;
  setRequestLocale(locale);
  const t = await getTranslations("Tax");
  const tp = await getTranslations("Period");

  const prefs = await loadPreferences();
  const regime = prefs?.taxRegime ?? "DE";

  const taxResult = await loadNetworthTaxResult(year, regime);
  const holders = taxResult.status === "ok" ? taxResult.holders : [];
  const detailByHolder = await loadTaxYearDetail(holders, year);

  if (TIMING) {
    // eslint-disable-next-line react-hooks/purity
    const durationMs = performance.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: `[timing] TaxPage data fetch`,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  }

  const Heading = (
    <>
      <PageHeader
        backHref="/reports"
        title={t("title")}
        subtitle={
          <>
            {regime === "ID"
              ? t("id.subtitle", { year: year ?? new Date().getUTCFullYear() })
              : t("subtitle")}
            <br />
            <RegimeIndicator regime={regime} t={t} />
          </>
        }
      />
    </>
  );

  if (taxResult.status !== "ok") {
    return (
      <div className="space-y-5">
        {Heading}
        <DataState status={taxResult.status} retryAfter={retryAfterOf(taxResult)} />
      </div>
    );
  }

  if (holders.length === 0) {
    const te = await getTranslations("Empty");
    return (
      <div className="space-y-5">
        {Heading}
        <EmptyState
          icon={Receipt}
          title={regime === "ID" ? te("noPortfolioTitle") : t("empty.title")}
          description={regime === "ID" ? te("noPortfolioBody") : t("empty.description")}
        />
      </div>
    );
  }

  const hasMultipleHolders = holders.length > 1;

  // Selectable tax years: every year with activity across holders, plus the current year
  // and whichever year is selected (so a deep link to an empty year stays selectable).
  const currentYear = new Date().getUTCFullYear();
  const yearOptions = new Set<number>([currentYear, year ?? currentYear]);
  for (const d of detailByHolder.values()) for (const y of d.byYear) yearOptions.add(y.year);

  return (
    <div className="space-y-5">
      {Heading}
      {/* DE: e.g. "EUR" when the euro allowance had no rate into the display currency (on the
          holder entries); ID: misses from the payloads the final-tax detail is built from. */}
      <FxMissingBanner currencies={collectFxMissing(...holders, ...detailByHolder.values())} />
      <PeriodSelect
        label={tp("taxYear")}
        value={String(year ?? currentYear)}
        defaultValue={String(currentYear)}
        options={[...yearOptions].sort((a, b) => b - a).map(String)}
      />
      <TaxPageCommands
        years={[...yearOptions].sort((a, b) => b - a).map(String)}
        selected={String(year ?? currentYear)}
        currentYear={String(currentYear)}
      />
      {holders.map((entry, idx) => {
        const detail = detailByHolder.get(entry.holder.id) ?? null;
        const currency = regime === "ID" ? (detail?.currency ?? entry.currency) : entry.currency;
        const money = (n: string | number) => formatMoney(Number(n), currency, locale);
        const isLast = idx === holders.length - 1;

        return (
          <section
            key={entry.holder.id}
            className={`space-y-4${hasMultipleHolders && !isLast ? " border-b border-border pb-5" : ""}`}
          >
            <div className="flex items-center gap-2">
              <Landmark className="size-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">
                {entry.holder.name || t("defaultHolderName")} — {entry.year}
              </h2>
            </div>
            {regime === "DE" && (
              /* When TaxHolderOverviewDe returns null (no allowance data), children
                 are also suppressed — detail tables intentionally not rendered. */
              <TaxHolderOverviewDe entry={entry} locale={locale} t={t}>
                <TaxHolderDetailDE
                  detail={detail}
                  currency={currency}
                  locale={locale}
                  year={entry.year}
                />
              </TaxHolderOverviewDe>
            )}
            {regime === "ID" && (
              <TaxHolderSectionId
                detail={detail}
                money={money}
                currency={currency}
                locale={locale}
                year={entry.year}
                t={t}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

function TaxHolderOverviewDe({
  entry,
  locale,
  t,
  children,
}: {
  entry: TaxSummaryHolderWithCarryForward;
  locale: string;
  t: TaxTranslator;
  children?: React.ReactNode;
}) {
  const currency = entry.currency;
  // Same whole-amount formatting as the FSA distribution tiles (tax-cards.tsx), so the
  // allowance never shows as "€1,000" in one tile and "€1,000.00" in the next.
  const money = (n: string | number) => formatMoneyWhole(Number(n), currency, locale);
  const moneyCompact = (n: string | number) => formatMoneyCompact(Number(n), currency, locale);
  const { allowanceUsage: u, harvestSuggestions, distribution, accountHolderId } = entry;
  // ID entries carry `indonesianFinalTax` instead of `allowanceUsage` — render nothing
  // here; the parent's `TaxHolderSectionId` branch will render the ID cards.
  if (!u) return null;
  // No allowance (e.g. it could not be converted without an EUR rate): nothing used, no NaN.
  const allowance = parseFloat(u.allowanceAnnual);
  const pct = allowance > 0 ? parseFloat(u.remaining) / allowance : 1;
  const usedPct = Math.round((1 - Math.max(0, Math.min(1, pct))) * 100);
  const hasForecast = Number(u.forecastIncomeRestOfYear) > 0;

  const taxRate = Number(u.taxRate);
  const taxable = Number(u.taxableExcess);
  const estimatedTax =
    u.estimatedTax != null && u.estimatedTax !== "" ? Number(u.estimatedTax) : taxable * taxRate;
  const ratePct = (taxRate * 100).toLocaleString(locale, { maximumFractionDigits: 3 });
  const foreignCredit = Number(u.foreignTaxCredit ?? 0);

  const harvestRemaining = u.projectedRemaining ?? u.remaining;
  const combinedHarvest = harvestSummary(harvestSuggestions, harvestRemaining, u.taxRate);

  return (
    <>
      <PageWithRail>
        {/* ── Main column: hero + detailed cards ── */}
        <div className="space-y-5">
          <EstimatedTaxHero
            label={t("hero.estimatedTax", { year: entry.year })}
            value={moneyCompact(estimatedTax)}
            description={
              foreignCredit > 0
                ? t("hero.estimatedTaxDescCredit", {
                    rate: ratePct,
                    taxable: money(taxable),
                    credit: money(foreignCredit),
                  })
                : t("hero.estimatedTaxDesc", { rate: ratePct, taxable: money(taxable) })
            }
          />

          <VorabpauschaleRow allowanceUsage={u} money={money} t={t} />

          {distribution && <DistributionCard distribution={distribution} locale={locale} t={t} />}

          {hasForecast && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarClock className="size-4" />
                  {t("forecast.label")}
                </CardTitle>
              </CardHeader>
              {/* Its own @container: this card sits in the main column beside the rail, so
                  <main>'s width says nothing about the room these tiles have. */}
              <CardContent className="@container space-y-4">
                <p className="text-xs text-muted-foreground">{t("forecast.disclaimer")}</p>
                {/* Full amounts in the display currency (e.g. "IDR 14,910,312") at StatCard's
                    viewport-keyed figure size. Phone (small figures): 2+1 once the card has
                    320px. Otherwise by this card's width: stacked, 2+1 from 512px (room at the
                    28px `lg:` size), 3-up from 768px. */}
                <div className="grid grid-cols-1 gap-2.5 max-sm:@xs:grid-cols-2 sm:gap-4 @lg:grid-cols-2 @3xl:grid-cols-3">
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
                    className="max-sm:@xs:col-span-2 @lg:col-span-2 @3xl:col-span-1"
                    label={t("forecast.projectedRemaining")}
                    value={money(u.projectedRemaining)}
                    delta={`${t("forecast.projectedTaxSaving")}: ${money(u.projectedTaxSavingAvailable)}`}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <CoverageCard allowanceUsage={u} money={money} locale={locale} t={t} />

          {accountHolderId && (
            <LossCarryforwardEditor holderId={accountHolderId} currentYear={entry.year} />
          )}

          <Card className="overflow-hidden rounded-lg">
            <div className="flex items-start justify-between gap-3 px-[22px] pb-1 pt-[18px]">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <TrendingUp className="size-4" />
                  {t("harvest.title")}
                </h2>
                <p className="mt-0.5 text-xs font-medium text-text-2">
                  {hasForecast ? t("harvest.subtitle") : t("harvest.subtitleNoForecast")}
                </p>
              </div>
              <span
                className="shrink-0 rounded-lg px-2.5 py-1 text-micro font-bold tracking-wide text-violet"
                style={{ backgroundColor: tint("violet", 16).bg }}
              >
                {entry.currency}
              </span>
            </div>

            <div className="px-[22px] pb-1.5 pt-3.5">
              <AllowanceSummaryBoxes
                usedPct={usedPct}
                allowanceAnnual={u.allowanceAnnual}
                usedYtd={u.usedYtd}
                remaining={u.remaining}
                taxSavingAvailable={u.taxSavingAvailable}
                taxable={taxable.toString()}
                estimatedTax={estimatedTax.toString()}
                money={money}
                t={t}
              />
            </div>

            {harvestSuggestions.length > 0 ? (
              <>
                <p className="px-[22px] pb-1 pt-2 text-micro font-bold uppercase tracking-wide text-text-2">
                  {t("harvest.positionsEyebrow")}
                </p>
                <div>
                  {harvestSuggestions.map((s) => (
                    <HarvestRow key={s.instrumentId} s={s} money={money} t={t} />
                  ))}
                </div>
                <HarvestSummaryNote
                  suggestions={harvestSuggestions}
                  combined={combinedHarvest}
                  money={money}
                  t={t}
                />
              </>
            ) : (
              <p className="px-[22px] pb-5 pt-1 text-sm text-muted-foreground">
                {t("harvest.none")}
              </p>
            )}
          </Card>

          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("footnote", { rate: ratePct, allowance: money(u.allowanceAnnual) })}
          </p>
          {children}
        </div>

        {/* ── Sidebar: KPI stat cards (sticky on wide containers) ── */}
        <PageRail className="space-y-2.5 sm:space-y-4">
          <StatCard
            label={t("hero.fsaUsed")}
            value={money(u.usedYtd)}
            delta={t("hero.fsaUsedDesc", { allowance: money(u.allowanceAnnual) })}
          />
          <StatCard
            label={t("hero.realizedGains")}
            value={money(u.realizedGainsAdjusted)}
            delta={t("hero.realizedGainsDesc", { count: 0 })}
          />
          <StatCard
            label={t("hero.dividendsYtd")}
            value={money(u.incomeYtd)}
            delta={t("hero.dividendsYtdDesc")}
          />
          <StatCard
            label={t("taxSavingAvailable")}
            value={money(u.taxSavingAvailable)}
            delta={t("taxSavingAvailableDesc", { remaining: money(u.remaining) })}
          />
        </PageRail>
      </PageWithRail>
    </>
  );
}

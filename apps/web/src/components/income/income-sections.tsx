import { deltaToneOf } from "@/lib/tone";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import {
  LazyAllocationDonut as AllocationDonut,
  LazyIncomeBarChart as IncomeBarChart,
} from "@/components/charts/lazy";
import { IncomeBarChartLegend } from "@/components/charts/income-bar-legend";
import { IncomeHeatmap } from "@/components/charts/income-heatmap";
import { YieldsTable } from "@/components/income/yields-table";
import { TABLE_LABEL, TABLE_SUBLABEL, TABLE_VALUE_STRONG } from "@/components/ui/table";
import { IncomeTimeline } from "@/components/income/income-timeline";
import { CashInterestLine } from "@/components/income/cash-interest-line";
import { IncomeCalendar } from "@/components/income/income-calendar";
import { IncomeCalendarEmpty } from "@/components/income/income-calendar-empty";
import type { IncomeEventRow } from "@/components/income/income-events-table";
import { incomeStatsOnce } from "@/components/income/income-data";
import { formatMoney, formatPercent, cn } from "@/lib/utils";

/*
 * One async server component per Income section. The page resolves `incomeStatsOnce()`
 * itself first (its error / empty states replace the whole page), then streams each section
 * behind its own <Suspense>; every section re-reads the same request-cached payload. A
 * section with nothing to show renders null.
 */

type SectionProps = { locale: string };

async function load() {
  const result = await incomeStatsOnce();
  return result.status === "ok" ? result.data : null;
}

export async function IncomeYearChartSection() {
  const [t, s] = await Promise.all([getTranslations("Income"), load()]);
  if (!s || s.byYear.length === 0) return null;
  const currency = s.displayCurrency;
  const currentYear = String(new Date().getUTCFullYear());

  // Yearly bars: current year includes projected rest-of-year as a stacked segment.
  const yearBars = [
    ...s.byYear.map((y) => ({
      label: y.year,
      value: Number(y.total),
      ...(y.year === currentYear ? { projected: Number(s.forecastRestOfYear) } : {}),
    })),
    { label: t("nextYear"), value: Number(s.forecastNextYear), forecast: true },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-x-3 gap-y-1.5 pb-2">
        <CardTitle>{t("perYearTitle")}</CardTitle>
        <IncomeBarChartLegend />
      </CardHeader>
      <CardContent>
        <IncomeBarChart data={yearBars} currency={currency} />
      </CardContent>
    </Card>
  );
}

/** Seasonality heatmap — full width for better readability. */
export async function IncomeSeasonalitySection() {
  const [t, s] = await Promise.all([getTranslations("Income"), load()]);
  if (!s || s.monthly.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t("seasonalityTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <IncomeHeatmap monthly={s.monthly} currency={s.displayCurrency} />
      </CardContent>
    </Card>
  );
}

/** Summary cards in a two-column grid. */
export async function IncomeSummarySection({ locale }: SectionProps) {
  const [t, s] = await Promise.all([getTranslations("Income"), load()]);
  if (!s) return null;
  if (!(s.byInstrument.length > 0 || s.yields.length > 0 || s.byCurrency.length > 1)) return null;
  const m = (n: number) => formatMoney(n, s.displayCurrency, locale);

  return (
    <div className="@container grid gap-4 @2xl:grid-cols-2 @2xl:items-start">
      {s.byInstrument.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("topContributorsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {s.byInstrument.slice(0, 8).map((c) => (
              <div key={c.instrumentId ?? c.symbol ?? "—"} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 flex-1 truncate">
                    <span className={TABLE_LABEL}>{c.symbol ?? "—"}</span>
                    {(c.displayName ?? c.name) && (
                      <span className={cn("ml-2", TABLE_SUBLABEL)}>{c.displayName ?? c.name}</span>
                    )}
                  </div>
                  <span className={cn("shrink-0", TABLE_VALUE_STRONG)}>
                    {m(Number(c.total))}{" "}
                    <span className="text-text-mute">({formatPercent(c.pct, locale)})</span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max(2, c.pct * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {s.yields.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle>{t("yieldTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <YieldsTable rows={s.yields} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Payments calendar (forward-looking, getquin-style) — sits above the timeline so the
 * user's primary question ("what's paying me next?") has the most prominent slot. Renders
 * its own empty state when `upcoming` is empty.
 */
export async function IncomeCalendarSection() {
  const s = await load();
  if (!s) return null;
  return s.upcoming.length > 0 ? <IncomeCalendar upcoming={s.upcoming} /> : <IncomeCalendarEmpty />;
}

/**
 * Payments timeline — one card, year sub-headers newest-first, with its own year/status
 * filter chips + search (reference).
 */
export async function IncomeTimelineSection({ locale }: SectionProps) {
  const s = await load();
  if (!s) return null;

  // Merge historical events + upcoming payments into one flat row array — the
  // year-grouping, next-year-forecast split, and per-year subtitle/subtotal logic now
  // live in <IncomeTimeline>, which re-runs them AFTER its own filters (year/status/
  // search) so a filtered view still groups and sorts correctly.
  const timelineRows: IncomeEventRow[] = [
    ...s.events,
    ...s.upcoming.map((u) => ({
      ...u,
      type: u.kind,
      growthApplied: u.growthApplied,
      assumesContributions: u.assumesContributions,
      perShare: u.perShare,
      quantity: u.quantity,
    })),
  ];
  if (timelineRows.length === 0) return null;

  // Years with data that aren't in the initial 3-year events window → collapsed
  // year headers that load on demand.
  const eventYears = new Set(s.events.map((e) => e.date.slice(0, 4)));
  const olderYears = s.byYear
    .map((y) => String(y.year))
    .filter((y) => !eventYears.has(y))
    .sort((a, b) => Number(b) - Number(a));

  return <IncomeTimeline rows={timelineRows} locale={locale} olderYears={olderYears} />;
}

/** Sidebar headline stat cards. */
export async function IncomeStatsSection({ locale }: SectionProps) {
  const [t, s] = await Promise.all([getTranslations("Income"), load()]);
  if (!s) return null;
  const m = (n: number) => formatMoney(n, s.displayCurrency, locale);

  const lastYearLabel = String(new Date().getUTCFullYear() - 1);
  const thisFullYear = Number(s.forecastFullYear);
  const lastYearTotal = Number(s.lastYear);
  const deltaAbs = thisFullYear - lastYearTotal;
  const deltaPct = lastYearTotal > 0 ? deltaAbs / lastYearTotal : null;

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 @xl:grid-cols-1">
      <StatCard
        label={t("thisYear")}
        value={m(thisFullYear)}
        delta={
          deltaPct !== null
            ? `${formatPercent(deltaPct, locale)} ${t("vsLastYear", { year: lastYearLabel })}`
            : undefined
        }
        deltaTone={deltaToneOf(deltaAbs)}
      />
      <StatCard label={t("ttm")} value={m(Number(s.ttm))} />
      <StatCard label={t("forecastNext12")} value={m(Number(s.forecastNextYear))} />
      <StatCard
        label={t("lifetime")}
        value={m(Number(s.lifetimeTotal))}
        basis={t("lifetimeBasis")}
      />
      <StatCard
        label={t("payments")}
        value={String(s.paymentCount)}
        delta={t("avgPerPayment", { avg: m(Number(s.averagePerPayment)) })}
        className="col-span-2 @xl:col-span-1"
      />
    </div>
  );
}

export async function IncomeCashInterestSection({ locale }: SectionProps) {
  const [t, s] = await Promise.all([getTranslations("Income"), load()]);
  if (!s || !(Number(s.interest.lifetime) > 0)) return null;
  const m = (n: number) => formatMoney(n, s.displayCurrency, locale);
  return (
    <CashInterestLine
      label={t("cashInterest")}
      ytdLabel={t("thisYear")}
      ttmLabel={t("ttm")}
      lifetimeLabel={t("lifetime")}
      ytd={m(Number(s.interest.ytd))}
      ttm={m(Number(s.interest.ttm))}
      lifetime={m(Number(s.interest.lifetime))}
    />
  );
}

export async function IncomeAllocationSection() {
  const [t, tc, s] = await Promise.all([
    getTranslations("Income"),
    getTranslations("AssetClass"),
    load(),
  ]);
  if (!s) return null;
  const classSlices = s.byAssetClass.map((c) => ({
    key: c.assetClass,
    label: tc(c.assetClass),
    value: Number(c.total),
  }));
  if (classSlices.length === 0) return null;
  return (
    <Card className="@container px-6 py-5">
      <p className="mb-3 text-micro font-semibold uppercase tracking-label text-text-2">
        {t("byClassTitle")}
      </p>
      <AllocationDonut
        data={classSlices}
        currency={s.displayCurrency}
        total={Number(s.lifetimeTotal)}
      />
    </Card>
  );
}

export async function IncomeCurrencySection() {
  const [t, s] = await Promise.all([getTranslations("Income"), load()]);
  if (!s || s.byCurrency.length <= 1) return null;
  return (
    <Card className="@container px-6 py-5">
      <p className="mb-3 text-micro font-semibold uppercase tracking-label text-text-2">
        {t("currencyTitle")}
      </p>
      <div className="grid grid-cols-1 gap-x-5 gap-y-2.5 @sm:grid-cols-2 @sm:gap-x-7 @lg:grid-cols-3">
        {s.byCurrency.map((c, i) => (
          <div key={c.currency} className="flex items-center gap-[9px]">
            <span
              className="size-[9px] shrink-0 rounded-xs"
              style={{
                background: `var(--color-chart-${(i % 5) + 1})`,
              }}
            />
            <span className="min-w-0 flex-1 truncate text-body-sm font-semibold">{c.currency}</span>
            <span className="tabular shrink-0 text-body-sm font-bold text-text-2">
              {Number(s.lifetimeTotal) > 0
                ? `${((Number(c.totalNormalized) / Number(s.lifetimeTotal)) * 100).toFixed(1)}%`
                : "—"}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

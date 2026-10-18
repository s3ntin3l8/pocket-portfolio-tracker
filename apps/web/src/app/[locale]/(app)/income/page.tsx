import { Suspense } from "react";
import { DataState } from "@/components/data-state";
import { retryAfterOf } from "@/lib/data-status";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Coins } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { incomeStatsOnce } from "@/components/income/income-data";
import {
  IncomeYearChartSection,
  IncomeSeasonalitySection,
  IncomeSummarySection,
  IncomeCalendarSection,
  IncomeTimelineSection,
  IncomeStatsSection,
  IncomeCashInterestSection,
  IncomeAllocationSection,
  IncomeCurrencySection,
} from "@/components/income/income-sections";
import { IncomeCardSkeleton, IncomeStatsSkeleton } from "@/components/income/income-skeletons";
import { PageRail, PageWithRail } from "@/components/page-with-rail";

const TIMING = typeof process !== "undefined" && process.env?.TIMING_ENABLED === "true";

export default async function IncomePage({ params }: { params: Promise<{ locale: string }> }) {
  // eslint-disable-next-line react-hooks/purity
  const t0 = TIMING ? performance.now() : 0;
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Income");
  const te = await getTranslations("Empty");

  // Holder scope is now global (cookie-based via the portfolio switcher).
  // loadIncomeStats() reads it automatically.
  const result = await incomeStatsOnce();

  if (TIMING) {
    // eslint-disable-next-line react-hooks/purity
    const durationMs = performance.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: `[timing] IncomePage data fetch`,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  }

  const heading = (
    <>
      <PageHeader backHref="/reports" title={t("title")} subtitle={t("subtitle")} />
    </>
  );

  if (result.status !== "ok") {
    return (
      <div className="space-y-5">
        {heading}
        <DataState
          status={result.status}
          retryAfter={retryAfterOf(result)}
          icon={Coins}
          empty={{ title: te("noPortfolioTitle"), description: te("noPortfolioBody") }}
        />
      </div>
    );
  }

  const s = result.data;
  // Cash interest counts too: an interest-only scope must reach the page (its sidebar
  // shows the interest line), not the "nothing recorded yet" empty state.
  const hasIncome =
    s.events.length > 0 ||
    s.yields.length > 0 ||
    s.upcoming.length > 0 ||
    Number(s.interest.lifetime) > 0;

  if (!hasIncome) {
    return (
      <div className="space-y-5">
        {heading}
        <EmptyState icon={Coins} title={t("emptyTitle")} description={t("emptyBody")} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {heading}

      <PageWithRail>
        {/* ── Main column: charts + summary + calendar + timeline ── */}
        <div className="space-y-5">
          <Suspense fallback={<IncomeCardSkeleton />}>
            <IncomeYearChartSection />
          </Suspense>
          <Suspense fallback={<IncomeCardSkeleton />}>
            <IncomeSeasonalitySection />
          </Suspense>
          <Suspense fallback={<IncomeCardSkeleton />}>
            <IncomeSummarySection locale={locale} />
          </Suspense>
          <Suspense fallback={<IncomeCardSkeleton />}>
            <IncomeCalendarSection />
          </Suspense>
          <Suspense fallback={<IncomeCardSkeleton height="h-64" />}>
            <IncomeTimelineSection locale={locale} />
          </Suspense>
        </div>

        {/* ── Sidebar: stat cards + cash interest + allocation donut (sticky on wide containers) ── */}
        <PageRail className="space-y-3.5">
          <Suspense fallback={<IncomeStatsSkeleton />}>
            <IncomeStatsSection locale={locale} />
          </Suspense>
          <Suspense fallback={null}>
            <IncomeCashInterestSection locale={locale} />
          </Suspense>
          <Suspense fallback={null}>
            <IncomeAllocationSection />
          </Suspense>
          <Suspense fallback={null}>
            <IncomeCurrencySection />
          </Suspense>
        </PageRail>
      </PageWithRail>
    </div>
  );
}

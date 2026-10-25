import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { ReportCardSkeleton } from "@/components/reports/report-card-skeleton";
import {
  IncomeCard,
  TradesCard,
  SavingsCard,
  TaxCard,
  GoldCard,
  DocumentsCard,
} from "@/components/reports/reports-cards";
import { ReportsStatus } from "@/components/reports/reports-status";
import { startReportsLoads } from "@/components/reports/reports-data";

/**
 * Reports hub. The heading paints immediately; every card is its own async server component
 * behind its own `<Suspense>`, so a slow endpoint (tax, trades) no longer holds back the
 * rest. All loaders are started up-front (request-cached, see reports-data) so the cards
 * overlap rather than waterfall. A card with no data renders nothing once it resolves.
 *
 * The cards follow the SELECTED scope, exactly like the neighbouring pages: every loader in
 * `reports-data.ts` resolves the scope itself (`getSelectedPortfolioId()` → the portfolio
 * endpoint, `resolveHolderScope()` → the holder endpoint, neither → the all-portfolio one).
 * So the page states no scope of its own — the shell's `PortfolioSwitcher` is the scope
 * control here, and a hard-coded scope line would be false for every scoped page.
 */
export default async function ReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Reports");

  startReportsLoads();

  const card = (node: React.ReactNode) => (
    <Suspense fallback={<ReportCardSkeleton />}>{node}</Suspense>
  );

  return (
    <div className="space-y-5">
      <PageHeader title={t("title")} />

      <Suspense fallback={null}>
        <ReportsStatus />
      </Suspense>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 @min-[1500px]:grid-cols-3">
        {card(<IncomeCard locale={locale} />)}
        {card(<TradesCard locale={locale} />)}
        {card(<SavingsCard locale={locale} />)}
        {card(<TaxCard locale={locale} />)}
        {card(<GoldCard locale={locale} />)}
        {card(<DocumentsCard />)}
      </div>
    </div>
  );
}

import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { TaxReportsInbox } from "@/components/tax-reports-inbox";
import { loadDocuments, resolveInboxScope } from "@/lib/server-api";

export default async function TaxReportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("TaxReports");

  const [documents, scope] = await Promise.all([loadDocuments("tax_report"), resolveInboxScope()]);
  // The picker and its default stay inside the same scope as the list. A holder scope
  // used to offer every portfolio and default to portfolios[0], which can be another
  // holder's — the upload succeeded and then vanished from the scoped refresh (#1155).
  const portfolios = scope.portfolios.map((p) => ({
    id: p.id,
    name: p.name,
    brokerage: p.brokerage,
    accountHolder: p.accountHolder,
  }));
  const initialPortfolioId = scope.portfolios[0]?.id ?? "";

  return (
    <div className="space-y-6">
      <PageHeader backHref="/reports" title={t("title")} subtitle={t("headerSubtitle")} />
      <TaxReportsInbox
        initialDocuments={documents}
        portfolios={portfolios}
        initialPortfolioId={initialPortfolioId}
        scopedPortfolioIds={scope.portfolioIds}
      />
    </div>
  );
}

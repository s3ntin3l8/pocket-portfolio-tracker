import { getTranslations, setRequestLocale } from "next-intl/server";
import { ReportHeader } from "@/components/report-header";
import { TaxReportsInbox } from "@/components/tax-reports-inbox";
import { loadDocuments } from "@/lib/server-api";

export default async function TaxReportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("TaxReports");

  const documents = await loadDocuments("tax_report");

  return (
    <div className="space-y-6">
      <ReportHeader title={t("title")} subtitle={t("headerSubtitle")} />
      <TaxReportsInbox initialDocuments={documents} />
    </div>
  );
}

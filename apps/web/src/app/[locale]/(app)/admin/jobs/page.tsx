import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminJobs } from "@/components/admin-jobs";
import { UnmappedTypesAlert } from "@/components/unmapped-types-alert";
import { PageHeader } from "@/components/page-header";
import { AdminGateFailure } from "@/components/admin-gate-failure";
import { requireAdmin, loadAdminJobs, loadUnmappedEventTypes } from "@/lib/server-api";

export default async function AdminJobsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const gate = await requireAdmin();
  if (gate.status !== "ok") return <AdminGateFailure gate={gate} />;

  const [result, unmappedTypes] = await Promise.all([loadAdminJobs(), loadUnmappedEventTypes()]);

  return (
    <>
      <PageHeader title={t("jobs")} backHref="/admin" />
      <p className="mb-4 text-sm text-muted-foreground">{t("jobsHint")}</p>

      <UnmappedTypesAlert types={unmappedTypes} />

      <div className="mt-4">
        {result.status === "ok" ? (
          <AdminJobs initialJobs={result.jobs} schedulerAvailable={result.schedulerAvailable} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
        )}
      </div>
    </>
  );
}

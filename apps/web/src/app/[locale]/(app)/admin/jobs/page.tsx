import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminJobs } from "@/components/admin-jobs";
import { UnmappedTypesAlert } from "@/components/unmapped-types-alert";
import { PageHeader } from "@/components/page-header";
import { AdminGateFailure } from "@/components/admin-gate-failure";
import { requireAdmin, loadAdminJobs, loadAdminUnmappedEventTypes } from "@/lib/server-api";

export default async function AdminJobsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const gate = await requireAdmin();
  if (gate.status !== "ok") return <AdminGateFailure gate={gate} />;

  const [result, unmappedByUser] = await Promise.all([
    loadAdminJobs(),
    loadAdminUnmappedEventTypes(),
  ]);

  return (
    <>
      <PageHeader title={t("jobs")} backHref="/admin" />
      <p className="mb-4 text-sm text-muted-foreground">{t("jobsHint")}</p>

      <div className="space-y-3">
        {unmappedByUser.map((u) => (
          <UnmappedTypesAlert key={u.userId} types={u.types} owner={u.email} />
        ))}
      </div>

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

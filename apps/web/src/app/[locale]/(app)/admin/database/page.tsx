import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminStats } from "@/components/admin-stats";
import { PageHeader } from "@/components/page-header";
import { AdminGateFailure } from "@/components/admin-gate-failure";
import { requireAdmin, loadAdminStats } from "@/lib/server-api";

export default async function AdminDatabasePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const gate = await requireAdmin();
  if (gate.status !== "ok") return <AdminGateFailure gate={gate} />;

  const result = await loadAdminStats();

  return (
    <>
      <PageHeader title={t("stats")} backHref="/admin" />
      <p className="mb-4 text-sm text-muted-foreground">{t("statsHint")}</p>
      {result.status === "ok" ? (
        <AdminStats stats={result.stats} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      )}
    </>
  );
}

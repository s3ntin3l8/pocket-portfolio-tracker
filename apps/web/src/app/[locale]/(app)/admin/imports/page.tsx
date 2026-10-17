import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminImportSettings } from "@/components/admin-import-settings";
import { PageHeader } from "@/components/page-header";
import { AdminGateFailure } from "@/components/admin-gate-failure";
import { requireAdmin, loadAdminImportSettings } from "@/lib/server-api";

export default async function AdminImportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const gate = await requireAdmin();
  if (gate.status !== "ok") return <AdminGateFailure gate={gate} />;

  const result = await loadAdminImportSettings();

  return (
    <>
      <PageHeader title={t("importStrategy")} backHref="/admin" />
      <p className="mb-4 text-sm text-muted-foreground">{t("importStrategyHint")}</p>
      {result.status === "ok" ? (
        <AdminImportSettings initialStrategy={result.strategy} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      )}
    </>
  );
}

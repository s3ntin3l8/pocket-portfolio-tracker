import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminImportSettings } from "@/components/admin-import-settings";
import { SectionHeader } from "@/components/section-header";
import { loadMe, loadAdminImportSettings } from "@/lib/server-api";

export default async function AdminImportsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const me = await loadMe();
  if (!me?.isAdmin) notFound();

  const result = await loadAdminImportSettings();

  return (
    <>
      <SectionHeader title={t("importStrategy")} backHref="/admin" />
      <p className="mb-4 text-sm text-muted-foreground">{t("importStrategyHint")}</p>
      {result.status === "ok" ? (
        <AdminImportSettings initialStrategy={result.strategy} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      )}
    </>
  );
}

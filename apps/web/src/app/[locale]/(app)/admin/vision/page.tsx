import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminVisionProviders } from "@/components/admin-vision-providers";
import { PageHeader } from "@/components/page-header";
import { AdminGateFailure } from "@/components/admin-gate-failure";
import { requireAdmin, loadAdminVisionProviders } from "@/lib/server-api";

export default async function AdminVisionPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const gate = await requireAdmin();
  if (gate.status !== "ok") return <AdminGateFailure gate={gate} />;

  const result = await loadAdminVisionProviders();

  return (
    <>
      <PageHeader title={t("visionProviders")} backHref="/admin" />
      <p className="mb-4 text-sm text-muted-foreground">{t("visionProvidersHint")}</p>
      {result.status === "ok" ? (
        <AdminVisionProviders
          initialProviders={result.providers}
          encryptionEnabled={result.encryptionEnabled}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      )}
    </>
  );
}

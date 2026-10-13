import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminProviders } from "@/components/admin-providers";
import { SectionHeader } from "@/components/section-header";
import { PageHeaderSetter } from "@/components/page-header";
import { AdminGateFailure } from "@/components/admin-gate-failure";
import { requireAdmin, loadAdminProviders } from "@/lib/server-api";

export default async function AdminProvidersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const gate = await requireAdmin();
  if (gate.status !== "ok") return <AdminGateFailure gate={gate} />;

  const result = await loadAdminProviders();

  return (
    <>
      <PageHeaderSetter title={t("providers")} backHref="/admin" />
      <SectionHeader title={t("providers")} backHref="/admin" />
      <p className="mb-4 text-sm text-muted-foreground">{t("providersHint")}</p>
      {result.status === "ok" ? (
        <AdminProviders
          initialProviders={result.providers}
          encryptionEnabled={result.encryptionEnabled}
        />
      ) : (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      )}
    </>
  );
}

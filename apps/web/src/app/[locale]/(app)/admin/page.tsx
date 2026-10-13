import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminProviders } from "@/components/admin-providers";
import { SectionHeader } from "@/components/section-header";
import { PageHeaderSetter } from "@/components/page-header";
import { AdminGateFailure } from "@/components/admin-gate-failure";
import { requireAdmin, loadAdminProviders } from "@/lib/server-api";

/**
 * `/admin` index. On mobile the shared `SettingsShell` shows the grouped landing menu
 * here instead of this content; on desktop this is the rail's default section (mirrors
 * the design's `view = state.view || "providers"`) — identical content to
 * `/admin/providers`, the mobile drill-in route for the same section.
 */
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const gate = await requireAdmin();
  if (gate.status !== "ok") return <AdminGateFailure gate={gate} />;

  const result = await loadAdminProviders();

  return (
    <>
      <PageHeaderSetter title={t("providers")} />
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

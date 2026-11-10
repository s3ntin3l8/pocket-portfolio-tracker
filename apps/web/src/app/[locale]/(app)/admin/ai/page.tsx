import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminAi } from "@/components/admin-ai";
import { PageHeader } from "@/components/page-header";
import { AdminGateFailure } from "@/components/admin-gate-failure";
import { requireAdmin, loadAdminAi } from "@/lib/server-api";

export default async function AdminAiPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const gate = await requireAdmin();
  if (gate.status !== "ok") return <AdminGateFailure gate={gate} />;

  const result = await loadAdminAi();

  return (
    <>
      <PageHeader title={t("aiProviders")} backHref="/admin" />
      <p className="mb-4 text-sm text-muted-foreground">{t("aiProvidersHint")}</p>
      {result.status === "ok" ? (
        <AdminAi initial={result} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      )}
    </>
  );
}

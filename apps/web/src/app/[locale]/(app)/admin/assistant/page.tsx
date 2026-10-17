import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminChatProviders } from "@/components/admin-chat-providers";
import { PageHeader } from "@/components/page-header";
import { AdminGateFailure } from "@/components/admin-gate-failure";
import { requireAdmin, loadAdminChatProviders } from "@/lib/server-api";

export default async function AdminAssistantPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const gate = await requireAdmin();
  if (gate.status !== "ok") return <AdminGateFailure gate={gate} />;

  const result = await loadAdminChatProviders();

  return (
    <>
      <PageHeader title={t("chatProviders")} backHref="/admin" />
      <p className="mb-4 text-sm text-muted-foreground">{t("chatProvidersHint")}</p>
      {result.status === "ok" ? (
        <AdminChatProviders initial={result} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      )}
    </>
  );
}

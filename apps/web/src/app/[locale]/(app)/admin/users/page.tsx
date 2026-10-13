import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminUsersTable } from "@/components/admin-users-table";
import { SectionHeader } from "@/components/section-header";
import { PageHeaderSetter } from "@/components/page-header";
import { AdminGateFailure } from "@/components/admin-gate-failure";
import { requireAdmin, loadAdminUsers } from "@/lib/server-api";

export default async function AdminUsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const gate = await requireAdmin();
  if (gate.status !== "ok") return <AdminGateFailure gate={gate} />;

  const result = await loadAdminUsers();

  return (
    <>
      <PageHeaderSetter title={t("users")} backHref="/admin" />
      <SectionHeader title={t("users")} backHref="/admin" />
      <p className="mb-4 text-sm text-muted-foreground">{t("usersHint")}</p>
      {result.status === "ok" ? (
        <AdminUsersTable users={result.users} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      )}
    </>
  );
}

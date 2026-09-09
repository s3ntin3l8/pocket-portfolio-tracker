import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminStorageForm } from "@/components/admin-storage-form";
import { SectionHeader } from "@/components/section-header";
import { PageHeaderSetter } from "@/components/page-header";
import { loadMe, loadAdminStorageProviders } from "@/lib/server-api";

export default async function AdminStoragePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Admin");

  const me = await loadMe();
  if (!me?.isAdmin) notFound();

  const result = await loadAdminStorageProviders();

  return (
    <>
      <PageHeaderSetter title={t("storage")} backHref="/admin" />
      <SectionHeader title={t("storage")} backHref="/admin" />
      <p className="mb-4 text-sm text-muted-foreground">{t("storageHint")}</p>
      {result.status === "ok" ? (
        <AdminStorageForm initial={result.storage} />
      ) : (
        <p className="text-sm text-muted-foreground">{t("unavailable")}</p>
      )}
    </>
  );
}

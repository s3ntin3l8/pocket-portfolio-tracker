import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { HolderEditForm } from "@/components/holder-edit-form";

/**
 * The design's inline "New account holder" page — tapping "Add holder" in Settings →
 * Portfolios & holders opens this, replacing the old create-Sheet flow.
 */
export default async function NewHolderPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("AccountHolders");

  return (
    <>
      <PageHeader title={t("createTitle")} backHref="/settings/portfolios" />
      <HolderEditForm mode="create" />
    </>
  );
}

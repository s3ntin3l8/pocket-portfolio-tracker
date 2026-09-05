import { getTranslations, setRequestLocale } from "next-intl/server";
import { SectionHeader } from "@/components/section-header";
import { PageHeaderSetter } from "@/components/page-header";
import { InvestingSection } from "@/components/settings-sections/investing-section";
import { loadPreferences } from "@/lib/server-api";

export default async function SettingsInvestingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings");
  const prefs = await loadPreferences();

  return (
    <>
      <PageHeaderSetter title={t("navInvesting")} backHref="/settings" />
      <SectionHeader title={t("navInvesting")} backHref="/settings" />
      <InvestingSection prefs={prefs} />
    </>
  );
}

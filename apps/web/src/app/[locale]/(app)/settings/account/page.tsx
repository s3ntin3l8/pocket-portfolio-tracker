import { getTranslations, setRequestLocale } from "next-intl/server";
import { SectionHeader } from "@/components/section-header";
import { PageHeaderSetter } from "@/components/page-header";
import { AccountSection } from "@/components/settings-sections/account-section";
import { loadMe } from "@/lib/server-api";

export default async function SettingsAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings");
  const me = await loadMe();

  return (
    <>
      <PageHeaderSetter title={t("navAccount")} backHref="/settings" />
      <SectionHeader title={t("navAccount")} backHref="/settings" />
      <AccountSection me={me} localAuthAvailable={Boolean(process.env.AUTH_LOCAL_SECRET)} />
    </>
  );
}

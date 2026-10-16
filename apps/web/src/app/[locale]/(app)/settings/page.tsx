import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { AccountSection } from "@/components/settings-sections/account-section";
import { loadMe } from "@/lib/server-api";

/**
 * `/settings` index. On mobile the shared `SettingsShell` shows the landing menu here
 * instead of this content; on desktop this is the rail's default section (mirrors the
 * design's `activeSection = section || "account"`) — identical content to
 * `/settings/account`, the mobile drill-in route for the same section.
 */
export default async function SettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings");
  const me = await loadMe();
  return (
    <>
      <PageHeader desktopBack={false} title={t("navAccount")} backHref="/settings" />
      <AccountSection me={me} localAuthAvailable={Boolean(process.env.AUTH_LOCAL_SECRET)} />
    </>
  );
}

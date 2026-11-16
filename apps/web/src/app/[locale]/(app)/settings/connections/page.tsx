import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { UnmappedTypesAlert } from "@/components/unmapped-types-alert";
import { DataConnectionsSection } from "@/components/settings-sections/data-connections-section";
import {
  loadApiTokens,
  loadTrConnection,
  loadIbkrConnection,
  loadUnmappedEventTypes,
} from "@/lib/server-api";

export default async function SettingsConnectionsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Settings");

  const [apiTokens, trConnection, ibkrConnection, unmappedTypes] = await Promise.all([
    loadApiTokens(),
    loadTrConnection(),
    loadIbkrConnection(),
    loadUnmappedEventTypes(),
  ]);

  return (
    <>
      <PageHeader title={t("navData")} backHref="/settings" />
      {/* Broker event types the sync could not classify: shown where the connections live, so the
          gap is findable without the admin pages. Renders nothing when there are none. */}
      <div className="mb-6 empty:hidden">
        <UnmappedTypesAlert types={unmappedTypes} />
      </div>
      <DataConnectionsSection
        apiTokens={apiTokens}
        trConnection={trConnection}
        ibkrConnection={ibkrConnection}
      />
    </>
  );
}

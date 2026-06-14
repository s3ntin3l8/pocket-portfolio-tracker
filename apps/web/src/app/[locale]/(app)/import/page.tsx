import { getTranslations, setRequestLocale } from "next-intl/server";
import { Upload } from "lucide-react";
import { ImportFlowClient } from "@/components/import-flow-client";
import { CreatePortfolio } from "@/components/create-portfolio";
import { EmptyState } from "@/components/empty-state";
import { loadPortfolio } from "@/lib/server-api";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Import");
  const te = await getTranslations("Empty");
  const tm = await getTranslations("Manage");

  const result = await loadPortfolio(async (_api, portfolio) => portfolio);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {result.status === "empty" ? tm("portfolio.needFirst") : t("subtitle")}
        </p>
      </div>

      {result.status === "unavailable" ? (
        <EmptyState
          icon={Upload}
          title={te("unavailableTitle")}
          description={te("unavailableBody")}
        />
      ) : result.status === "empty" ? (
        <CreatePortfolio />
      ) : (
        <ImportFlowClient portfolioId={result.portfolio.id} />
      )}
    </div>
  );
}

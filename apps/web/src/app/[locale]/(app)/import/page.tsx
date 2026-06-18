import { getTranslations, setRequestLocale } from "next-intl/server";
import { History } from "lucide-react";
import { ImportHistory } from "@/components/import-history";
import { EmptyState } from "@/components/empty-state";
import { loadImports } from "@/lib/server-api";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const th = await getTranslations("ImportHistory");
  const te = await getTranslations("Empty");

  const imports = await loadImports();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{th("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{th("pageSubtitle")}</p>
      </div>

      {imports.length === 0 ? (
        <EmptyState
          icon={History}
          title={te("noImportsTitle")}
          description={te("noImportsBody")}
        />
      ) : (
        <ImportHistory items={imports} />
      )}
    </div>
  );
}

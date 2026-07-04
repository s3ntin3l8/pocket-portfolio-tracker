import { TriangleAlert, Info, CircleCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { Link } from "@/i18n/navigation";
import type { HarvestSuggestion, TaxDistribution } from "@portfolio/api-client";

/** Loosely-typed next-intl translator scoped to the `Tax` namespace — the same shape as
 *  `getTranslations("Tax")` (server) or `useTranslations("Tax")` (client), threaded down
 *  as a prop rather than re-derived in each subcomponent. */
export type TaxTranslator = (key: string, values?: Record<string, string | number>) => string;

export function DistributionCard({
  distribution: d,
  money,
  t,
}: {
  distribution: TaxDistribution;
  money: (n: string | number) => string;
  t: TaxTranslator;
}) {
  const allocPct = Number(d.holderAllowanceCap) > 0
    ? Math.round((Number(d.totalAllocated) / Number(d.holderAllowanceCap)) * 100)
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="size-4" />
          {t("distribution.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label={t("distribution.cap")}
            value={money(d.holderAllowanceCap)}
            delta={t("distribution.capDesc")}
          />
          <StatCard
            label={t("distribution.allocated")}
            value={money(d.totalAllocated)}
            delta={`${allocPct}%`}
          />
          <StatCard
            label={t("distribution.remaining")}
            value={money(d.remainingToDistribute)}
            delta={t("distribution.remainingDesc")}
          />
        </div>
        {d.overAllocated && (
          <div className="flex items-start gap-2 rounded-md border border-yellow-400 bg-yellow-50 dark:bg-yellow-950 dark:border-yellow-600 px-3 py-2 text-sm text-yellow-800 dark:text-yellow-200">
            <TriangleAlert className="size-4 mt-0.5 shrink-0" />
            <span>{t("distribution.overAllocated")}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Footer sentence aggregating every harvestable position currently shown. */
export function HarvestSummaryNote({
  suggestions,
  money,
  t,
}: {
  suggestions: HarvestSuggestion[];
  money: (n: string | number) => string;
  t: TaxTranslator;
}) {
  const totalHarvestable = suggestions.reduce((s, h) => s + Number(h.harvestableGross), 0);
  const totalSaving = suggestions.reduce((s, h) => s + Number(h.taxSaving), 0);
  if (totalHarvestable <= 0) return null;

  return (
    <div className="mt-4 flex items-start gap-2.5 rounded-lg bg-emerald-500/10 p-3.5 text-sm">
      <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
      <p className="text-muted-foreground">
        {t("harvest.summary", {
          count: suggestions.length,
          offset: money(totalHarvestable),
          saving: money(totalSaving),
        })}
      </p>
    </div>
  );
}

export function HarvestRow({
  s,
  money,
  t,
}: {
  s: HarvestSuggestion;
  money: (n: string | number) => string;
  t: TaxTranslator;
}) {
  const tfPct = Math.round(parseFloat(s.tfRate) * 100);

  return (
    <div className="py-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5 sm:items-center">
      <div className="col-span-2 sm:col-span-1">
        <p className="font-medium text-sm">{s.instrument?.symbol ?? s.instrumentId.slice(0, 8)}</p>
        <p className="text-xs text-muted-foreground">{s.instrument?.name}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{t("harvest.unrealized")}</p>
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
          {money(s.unrealizedGross)}
        </p>
        {tfPct > 0 && (
          <p className="text-xs text-muted-foreground">
            {t("harvest.tfApplied", { pct: tfPct })}
          </p>
        )}
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{t("harvest.harvestable")}</p>
        <p className="text-sm font-medium">{money(s.harvestableGross)}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{t("harvest.taxSaving")}</p>
        <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
          {money(s.taxSaving)}
        </p>
      </div>
      <div className="col-span-2 sm:col-span-1 sm:text-right">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/transactions/new?harvestInstrument=${s.instrumentId}`}>
            {t("harvest.button")}
          </Link>
        </Button>
      </div>
    </div>
  );
}

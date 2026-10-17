import { useTranslations } from "next-intl";
import { Card, CardLabel } from "@/components/ui/card";
import type { AllocationBreakdown } from "@portfolio/api-client";

const nonZero = (slices: AllocationBreakdown["byRegion"]) =>
  slices.filter((s) => Number(s.value) > 0).length;

/**
 * Insights rail tile: how many asset classes are held, captioned with the number of
 * non-zero regions (the merged region buckets of `allocation.byRegion`, not individual
 * markets or exchanges) and currencies.
 */
export function DiversificationCard({
  allocation,
  classCount,
}: {
  allocation: AllocationBreakdown;
  classCount: number;
}) {
  const t = useTranslations("Insights.diversification");
  const regionCount = nonZero(allocation.byRegion);
  const currencyCount = nonZero(allocation.byCurrency);

  return (
    <Card className="p-4">
      <CardLabel>{t("label")}</CardLabel>
      <p className="mt-1 text-heading font-bold leading-none">
        {t("value", { count: classCount })}
      </p>
      <CardLabel className="mt-1">
        {t("caption", { regions: regionCount, currencies: currencyCount })}
      </CardLabel>
    </Card>
  );
}

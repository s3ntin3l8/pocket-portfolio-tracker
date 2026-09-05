"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { AllocationTabs, ConcentrationBadge } from "@/components/charts/allocation-tabs";
import type { AllocationBreakdown, HoldingValuation } from "@portfolio/api-client";

export function CompositionCard({
  allocation,
  currency,
  holdings,
}: {
  allocation: AllocationBreakdown;
  currency: string;
  holdings?: HoldingValuation[];
}) {
  const t = useTranslations("Insights.composition");

  return (
    <Card className="rounded-[20px] bg-card p-4 shadow-card">
      <div className="flex items-center gap-2 p-2 pb-0">
        <p className="text-sm font-semibold">{t("title")}</p>
        <ConcentrationBadge label={allocation.concentration.label} />
      </div>
      <AllocationTabs allocation={allocation} currency={currency} holdings={holdings} />
    </Card>
  );
}

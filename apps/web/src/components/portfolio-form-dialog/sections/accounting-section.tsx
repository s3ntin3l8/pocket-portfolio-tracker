"use client";

import { useTranslations } from "next-intl";
import { ToggleRow } from "@/components/ui/toggle-row";

export function AccountingSection({
  cashCounted,
  documentRetention,
  includeInAggregate,
  onCashCountedChange,
  onDocumentRetentionChange,
  onIncludeInAggregateChange,
}: {
  cashCounted: boolean;
  documentRetention: boolean;
  includeInAggregate: boolean;
  onCashCountedChange: (v: boolean) => void;
  onDocumentRetentionChange: (v: boolean) => void;
  onIncludeInAggregateChange: (v: boolean) => void;
}) {
  const t = useTranslations("PortfolioForm");

  return (
    <div className="space-y-3">
      <ToggleRow
        id="cashCounted"
        label={t("cashCounted")}
        hint={t("cashCountedHint")}
        checked={cashCounted}
        onCheckedChange={onCashCountedChange}
      />
      <ToggleRow
        id="documentRetention"
        label={t("documentRetention")}
        hint={t("documentRetentionHint")}
        checked={documentRetention}
        onCheckedChange={onDocumentRetentionChange}
      />
      <ToggleRow
        id="includeInAggregate"
        label={t("includeInAggregate")}
        hint={t("includeInAggregateHint")}
        checked={includeInAggregate}
        onCheckedChange={onIncludeInAggregateChange}
      />
    </div>
  );
}

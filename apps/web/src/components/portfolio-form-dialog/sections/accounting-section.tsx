"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { ToggleRow } from "@/components/ui/toggle-row";

export function AccountingSection({
  cashCounted,
  allowNegativeCash,
  documentRetention,
  includeInAggregate,
  onCashCountedChange,
  onAllowNegativeCashChange,
  onDocumentRetentionChange,
  onIncludeInAggregateChange,
}: {
  cashCounted: boolean;
  allowNegativeCash: boolean;
  documentRetention: boolean;
  includeInAggregate: boolean;
  onCashCountedChange: (v: boolean) => void;
  onAllowNegativeCashChange: (v: boolean) => void;
  onDocumentRetentionChange: (v: boolean) => void;
  onIncludeInAggregateChange: (v: boolean) => void;
}) {
  const t = useTranslations("PortfolioForm");
  // Distinct per mount so two form hosts (e.g. a Sheet open over a full-page form) never
  // collide on the same toggle id — see the "duplicate ids" finding on #625.
  const uid = useId();

  return (
    <div className="space-y-3">
      <ToggleRow
        id={`${uid}-cashCounted`}
        label={t("cashCounted")}
        hint={t("cashCountedHint")}
        checked={cashCounted}
        onCheckedChange={onCashCountedChange}
      />
      {cashCounted && (
        <ToggleRow
          id={`${uid}-allowNegativeCash`}
          label={t("allowNegativeCash")}
          hint={t("allowNegativeCashHint")}
          checked={allowNegativeCash}
          onCheckedChange={onAllowNegativeCashChange}
        />
      )}
      <ToggleRow
        id={`${uid}-documentRetention`}
        label={t("documentRetention")}
        hint={t("documentRetentionHint")}
        checked={documentRetention}
        onCheckedChange={onDocumentRetentionChange}
      />
      <ToggleRow
        id={`${uid}-includeInAggregate`}
        label={t("includeInAggregate")}
        hint={t("includeInAggregateHint")}
        checked={includeInAggregate}
        onCheckedChange={onIncludeInAggregateChange}
      />
    </div>
  );
}

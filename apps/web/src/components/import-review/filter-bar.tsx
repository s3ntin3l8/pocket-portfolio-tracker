"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function ChipGroup({
  label,
  values,
  selected,
  onToggle,
}: {
  label: string;
  values: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}:</span>
      {values.map((v) => (
        <Button
          key={v}
          type="button"
          size="sm"
          variant={selected.has(v) ? "default" : "outline"}
          aria-pressed={selected.has(v)}
          className="h-7 px-2 text-xs"
          onClick={() => onToggle(v)}
        >
          {v}
        </Button>
      ))}
    </div>
  );
}

export interface FilterBarProps {
  assetClasses: string[];
  assetClassFilter: Set<string>;
  onToggleAssetClass: (value: string) => void;
  actions: string[];
  actionFilter: Set<string>;
  onToggleAction: (value: string) => void;
  needsReviewOnly: boolean;
  onNeedsReviewChange: (checked: boolean) => void;
  query: string;
  onQueryChange: (value: string) => void;
  filtersActive: boolean;
  viewLength: number;
  draftsLength: number;
  onClearFilters: () => void;
}

export function FilterBar(props: FilterBarProps) {
  const t = useTranslations("Import");
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {props.assetClasses.length > 1 && (
        <ChipGroup
          label={t("review.filters.assetClass")}
          values={props.assetClasses}
          selected={props.assetClassFilter}
          onToggle={props.onToggleAssetClass}
        />
      )}
      {props.actions.length > 1 && (
        <ChipGroup
          label={t("review.filters.action")}
          values={props.actions}
          selected={props.actionFilter}
          onToggle={props.onToggleAction}
        />
      )}
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          className="size-4 align-middle accent-primary"
          checked={props.needsReviewOnly}
          onChange={(e) => props.onNeedsReviewChange(e.target.checked)}
        />
        {t("review.filters.needsReview")}
      </label>
      <Input
        type="search"
        aria-label={t("review.filters.search")}
        placeholder={t("review.filters.search")}
        value={props.query}
        onChange={(e) => props.onQueryChange(e.target.value)}
        className="h-9 sm:w-48"
      />
      {props.filtersActive && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {t("review.filters.showing", { shown: props.viewLength, total: props.draftsLength })}
          </span>
          <Button variant="ghost" size="sm" onClick={props.onClearFilters}>
            {t("review.filters.clear")}
          </Button>
        </div>
      )}
    </div>
  );
}

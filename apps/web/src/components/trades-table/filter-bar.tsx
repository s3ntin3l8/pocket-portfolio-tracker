"use client";

import { useTranslations } from "next-intl";
import { FilterChip, YearFilterDropdown } from "@/components/filter-bar";
import { TableToolbar, TOOLBAR_FILTERS, ToolbarSearch } from "@/components/table-toolbar";
import type { StatusFilter, PnlFilter } from "./constants";

export function FilterBar({
  statusFilter,
  setStatusFilter,
  yearFilter,
  setYearFilter,
  yearOptions,
  pnlFilter,
  setPnlFilter,
  query,
  setQuery,
}: {
  statusFilter: StatusFilter;
  setStatusFilter: (v: StatusFilter) => void;
  yearFilter: string | null;
  setYearFilter: (v: string | null) => void;
  yearOptions: string[];
  pnlFilter: PnlFilter;
  setPnlFilter: (v: PnlFilter) => void;
  query: string;
  setQuery: (v: string) => void;
}) {
  const t = useTranslations("Trades");

  return (
    <TableToolbar
      filters={
        <div className={TOOLBAR_FILTERS}>
          {(
            [
              ["all", t("filter_all")],
              ["open", t("filter_open")],
              ["closed", t("filter_closed")],
            ] as const
          ).map(([key, label]) => (
            <FilterChip
              key={key}
              active={statusFilter === key}
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </FilterChip>
          ))}

          {yearOptions.length > 1 && (
            <YearFilterDropdown
              value={yearFilter}
              options={yearOptions}
              onChange={setYearFilter}
              label={t("filterYear")}
              allLabel={t("allYears")}
            />
          )}

          {(
            [
              ["all", t("filter_all")],
              ["gain", t("filter_gain")],
              ["loss", t("filter_loss")],
            ] as const
          ).map(([key, label]) => (
            <FilterChip key={key} active={pnlFilter === key} onClick={() => setPnlFilter(key)}>
              {label}
            </FilterChip>
          ))}
        </div>
      }
      search={
        <ToolbarSearch
          value={query}
          onChange={setQuery}
          placeholder={t("searchPlaceholder")}
          clearLabel={t("searchClear")}
        />
      }
    />
  );
}

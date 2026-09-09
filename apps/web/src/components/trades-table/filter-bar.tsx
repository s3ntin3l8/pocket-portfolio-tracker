"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { CHIP_BASE, CHIP_ACTIVE, CHIP_INACTIVE } from "@/components/ui/table";
import { TableToolbar, TOOLBAR_FILTERS, ToolbarSearch } from "@/components/table-toolbar";
import type { StatusFilter } from "./constants";

export function FilterBar({
  statusFilter,
  setStatusFilter,
  query,
  setQuery,
}: {
  statusFilter: StatusFilter;
  setStatusFilter: (v: StatusFilter) => void;
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
            <button
              key={key}
              type="button"
              onClick={() => setStatusFilter(key)}
              aria-pressed={statusFilter === key}
              className={cn(CHIP_BASE, statusFilter === key ? CHIP_ACTIVE : CHIP_INACTIVE)}
            >
              {label}
            </button>
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

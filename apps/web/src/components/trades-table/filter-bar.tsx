"use client";

import { useTranslations } from "next-intl";
import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CHIP_BASE, CHIP_ACTIVE, CHIP_INACTIVE } from "@/components/ui/table";
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

          {yearOptions.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("filterYear")}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card pl-3 pr-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {yearFilter ?? t("allYears")}
                  <ChevronDown className="size-3.5 shrink-0 text-text-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[9rem]">
                {["all", ...yearOptions].map((y) => (
                  <DropdownMenuItem
                    key={y}
                    onSelect={() => setYearFilter(y === "all" ? null : y)}
                    className="justify-between gap-3"
                  >
                    {y === "all" ? t("allYears") : y}
                    {(y === "all" ? !yearFilter : yearFilter === y) && (
                      <Check className="size-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {(
            [
              ["all", t("filter_all")],
              ["gain", t("filter_gain")],
              ["loss", t("filter_loss")],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPnlFilter(key)}
              aria-pressed={pnlFilter === key}
              className={cn(CHIP_BASE, pnlFilter === key ? CHIP_ACTIVE : CHIP_INACTIVE)}
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

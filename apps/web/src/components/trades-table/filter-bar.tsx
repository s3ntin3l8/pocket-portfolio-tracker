"use client";

import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
      {/* Chips scroll horizontally on mobile (no awkward multi-line wrap); wrap on
          desktop. Same reference pattern as the Activity/transactions filter row. */}
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
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
            className={cn(
              "whitespace-nowrap rounded-full px-3.5 py-[7px] text-xs",
              statusFilter === key
                ? "bg-pill font-bold text-white"
                : "border border-border bg-card font-semibold text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="relative flex items-center sm:ml-auto">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
        <Input
          type="text"
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 w-full pl-7 pr-7 text-xs sm:w-44"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={t("searchClear")}
            className="absolute right-2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X, ChevronDown, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function FilterBar({
  typeFilter,
  showFlagged,
  flaggedCount,
  onToggleFlagged,
  yearOptions,
  yearFilterProp,
  onNavigateWithParam,
  draftCount,
  draftFilter,
  onDraftFilterChange,
  searchQuery,
  onSearchChange,
}: {
  typeFilter?: string;
  showFlagged: boolean;
  flaggedCount: number;
  onToggleFlagged: () => void;
  yearOptions: string[];
  yearFilterProp?: string;
  onNavigateWithParam: (key: string, value: string | undefined) => void;
  draftCount: number;
  draftFilter: "all" | "drafts";
  onDraftFilterChange: (v: "all" | "drafts") => void;
  searchQuery?: string;
  onSearchChange: (v?: string) => void;
}) {
  const t = useTranslations("Transactions");
  const tBanner = useTranslations("Transactions.banners");

  const [localQuery, setLocalQuery] = useState(searchQuery ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return (
    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
        {(
          [
            ["all", t("filterAll")],
            ["buy", tBanner("chipBuys")],
            ["sell", tBanner("chipSells")],
            ["income", tBanner("chipIncome")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onNavigateWithParam("type", key === "all" ? undefined : key)}
            aria-pressed={key === "all" ? !typeFilter : typeFilter === key}
            className={cn(
              "whitespace-nowrap rounded-full px-3.5 py-[7px] text-xs",
              (key === "all" ? !typeFilter : typeFilter === key)
                ? "bg-pill font-bold text-white"
                : "border border-border bg-card font-semibold text-foreground",
            )}
          >
            {label}
          </button>
        ))}
        {flaggedCount > 0 && (
          <button
            type="button"
            onClick={onToggleFlagged}
            aria-pressed={showFlagged}
            className={cn(
              "whitespace-nowrap rounded-full border px-3 py-[7px] text-xs font-bold",
              showFlagged
                ? "border-[var(--gold-fg)] bg-[var(--gold-fg)] text-white"
                : "border-[rgba(224,165,58,.34)] bg-[rgba(224,165,58,.12)] text-[var(--gold-fg)]",
            )}
          >
            {tBanner("chipIssues", { count: flaggedCount })}
          </button>
        )}
        {yearOptions.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("filterYear")}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card pl-3 pr-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {yearFilterProp ?? t("allYears")}
                <ChevronDown className="size-3.5 shrink-0 text-text-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[9rem]">
              {["all", ...yearOptions].map((y) => (
                <DropdownMenuItem
                  key={y}
                  onSelect={() => onNavigateWithParam("year", y === "all" ? undefined : y)}
                  className="justify-between gap-3"
                >
                  {y === "all" ? t("allYears") : y}
                  {(y === "all" ? !yearFilterProp : yearFilterProp === y) && (
                    <Check className="size-4 text-primary" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {draftCount > 0 && (
          <select
            aria-label={t("filterDraftLabel")}
            value={draftFilter}
            onChange={(e) => onDraftFilterChange(e.target.value as "all" | "drafts")}
            className="h-8 rounded-full border border-border bg-card px-2.5 text-xs font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="all">{t("draftShowAll")}</option>
            <option value="drafts">{t("draftOnly", { count: draftCount })}</option>
          </select>
        )}
      </div>
      <div className="relative flex items-center sm:ml-auto">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
        <Input
          type="text"
          placeholder={t("searchPlaceholder")}
          value={localQuery}
          onChange={(e) => {
            const v = e.target.value;
            setLocalQuery(v);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => {
              onSearchChange(v || undefined);
            }, 300);
          }}
          className="h-8 w-full pl-7 pr-7 text-xs sm:w-44"
        />
        {localQuery && (
          <button
            type="button"
            onClick={() => {
              setLocalQuery("");
              if (debounceRef.current) clearTimeout(debounceRef.current);
              onSearchChange(undefined);
            }}
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

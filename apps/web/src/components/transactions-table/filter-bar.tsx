"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X, ChevronDown, Check, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const activeFilterCount = [
    typeFilter != null,
    showFlagged,
    yearFilterProp != null,
    draftFilter !== "all",
    searchQuery != null && searchQuery.length > 0,
  ].filter(Boolean).length;

  const typeChips = (
    <>
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
    </>
  );

  return (
    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
      {/* Desktop: inline chips */}
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        {typeChips}
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
        {(draftCount > 0 || draftFilter !== "all") && (
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

      {/* Mobile: search + filter button — search stays inline rather than living inside
          the filter Sheet, so it's reachable in one tap and results update on a visible
          list instead of behind an open sheet. */}
      <div className="flex items-center gap-2 sm:hidden">
        <div className="relative flex flex-1 items-center">
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
            className="h-9 w-full pl-7 pr-7 text-xs"
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

        <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={t("filterLabel")}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                activeFilterCount > 0
                  ? "border-pill bg-pill text-white"
                  : "border-border bg-card text-foreground",
              )}
            >
              <SlidersHorizontal className="size-3.5" />
              {t("filterLabel")}
              {activeFilterCount > 0 && (
                <span className="ml-0.5 flex size-4 items-center justify-center rounded-full bg-white/20 text-[9px] font-bold">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="rounded-t-[20px] px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
          >
            <SheetHeader className="pb-3 pt-1">
              <SheetTitle className="text-left text-base">{t("filterLabel")}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col gap-4">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.04em] text-text-3">
                  {t("filterType")}
                </p>
                <div className="flex flex-wrap gap-2">{typeChips}</div>
              </div>

              {yearOptions.length > 1 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.04em] text-text-3">
                    {t("filterYear")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {["all", ...yearOptions].map((y) => (
                      <button
                        key={y}
                        type="button"
                        onClick={() => {
                          onNavigateWithParam("year", y === "all" ? undefined : y);
                          setMobileFilterOpen(false);
                        }}
                        className={cn(
                          "whitespace-nowrap rounded-full px-3.5 py-[7px] text-xs",
                          (y === "all" ? !yearFilterProp : yearFilterProp === y)
                            ? "bg-pill font-bold text-white"
                            : "border border-border bg-card font-semibold text-foreground",
                        )}
                      >
                        {y === "all" ? t("allYears") : y}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {(draftCount > 0 || draftFilter !== "all") && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.04em] text-text-3">
                    {t("filterDraftLabel")}
                  </p>
                  <div className="flex gap-2">
                    {(["all", "drafts"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          onDraftFilterChange(v);
                          setMobileFilterOpen(false);
                        }}
                        className={cn(
                          "whitespace-nowrap rounded-full px-3.5 py-[7px] text-xs",
                          draftFilter === v
                            ? "bg-pill font-bold text-white"
                            : "border border-border bg-card font-semibold text-foreground",
                        )}
                      >
                        {v === "all" ? t("draftShowAll") : t("draftOnly", { count: draftCount })}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Desktop search */}
      <div className="relative hidden items-center sm:flex sm:ml-auto">
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

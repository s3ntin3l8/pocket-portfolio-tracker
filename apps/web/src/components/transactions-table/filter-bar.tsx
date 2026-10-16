"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SlidersHorizontal } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  TableToolbar,
  TOOLBAR_FILTERS_DESKTOP_ONLY,
  ToolbarSearch,
} from "@/components/table-toolbar";
import { FilterChip, YearFilterDropdown } from "@/components/filter-bar";
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
  actions,
}: {
  typeFilter?: string;
  showFlagged: boolean;
  flaggedCount: number;
  onToggleFlagged: () => void;
  yearOptions: string[];
  yearFilterProp?: string;
  onNavigateWithParam: (
    keyOrUpdates: string | Record<string, string | undefined>,
    value?: string,
  ) => void;
  draftCount: number;
  draftFilter: "all" | "drafts";
  onDraftFilterChange: (v: "all" | "drafts") => void;
  searchQuery?: string;
  onSearchChange: (v?: string) => void;
  /** Export CSV / export documents buttons — rendered right of the search input. */
  actions?: React.ReactNode;
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

  // The filter Sheet's own scope — excludes search, which lives outside it (inline,
  // with its own clear-X) and has nothing to do with the sheet's "Clear all".
  const sheetFilterCount = [
    typeFilter != null,
    showFlagged,
    yearFilterProp != null,
    draftFilter !== "all",
  ].filter(Boolean).length;

  const activeFilterCount =
    sheetFilterCount + (searchQuery != null && searchQuery.length > 0 ? 1 : 0);

  function clearAllFilters() {
    // One batched call, not two sequential single-key ones — see useTransactionUrlNav's
    // doc comment: two `router.push()` calls in the same handler race against the same
    // stale `searchParams` snapshot and can resolve out of order (observed live as the
    // year filter silently reappearing after closing the sheet right after "Clear all").
    onNavigateWithParam({ type: undefined, year: undefined, status: undefined });
    if (showFlagged) onToggleFlagged();
  }

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
        <FilterChip
          key={key}
          active={key === "all" ? !typeFilter : typeFilter === key}
          onClick={() => onNavigateWithParam("type", key === "all" ? undefined : key)}
        >
          {label}
        </FilterChip>
      ))}
      {flaggedCount > 0 && (
        <button
          type="button"
          onClick={onToggleFlagged}
          aria-pressed={showFlagged}
          className={cn(
            "whitespace-nowrap rounded-full border px-3 py-[7px] text-xs font-bold",
            showFlagged
              ? "border-gold-fg bg-gold-fg text-warning-foreground"
              : "border-gold-fg/35 bg-gold-fg/15 text-warn-strong",
          )}
        >
          {tBanner("chipIssues", { count: flaggedCount })}
        </button>
      )}
    </>
  );

  function handleSearchChange(v: string) {
    setLocalQuery(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchChange(v || undefined);
    }, 300);
  }

  // Filter Sheet trigger — visible only on mobile (`md:hidden`); its chips live in the
  // desktop-only wrapper below, duplicated inside the Sheet content further down.
  const filterSheetTrigger = (
    <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={t("filterLabel")}
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring md:hidden",
            activeFilterCount > 0
              ? "border-pill bg-pill text-white"
              : "border-border bg-card text-foreground",
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          {t("filterLabel")}
          {activeFilterCount > 0 && (
            <span className="ml-0.5 flex size-4 items-center justify-center rounded-full bg-white/20 text-micro font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-xl px-5">
        <SheetHeader className="pb-3 pt-1">
          <SheetTitle className="text-left text-base">{t("filterLabel")}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 text-micro font-semibold uppercase tracking-label text-text-2">
              {t("filterType")}
            </p>
            <div className="flex flex-wrap gap-2">{typeChips}</div>
          </div>

          {yearOptions.length > 1 && (
            <div>
              <p className="mb-2 text-micro font-semibold uppercase tracking-label text-text-2">
                {t("filterYear")}
              </p>
              <div className="flex flex-wrap gap-2">
                {["all", ...yearOptions].map((y) => (
                  <FilterChip
                    key={y}
                    active={y === "all" ? !yearFilterProp : yearFilterProp === y}
                    onClick={() => onNavigateWithParam("year", y === "all" ? undefined : y)}
                  >
                    {y === "all" ? t("allYears") : y}
                  </FilterChip>
                ))}
              </div>
            </div>
          )}

          {(draftCount > 0 || draftFilter !== "all") && (
            <div>
              <p className="mb-2 text-micro font-semibold uppercase tracking-label text-text-2">
                {t("filterDraftLabel")}
              </p>
              <div className="flex gap-2">
                {(["all", "drafts"] as const).map((v) => (
                  <FilterChip
                    key={v}
                    active={draftFilter === v}
                    onClick={() => onDraftFilterChange(v)}
                  >
                    {v === "all" ? t("draftShowAll") : t("draftOnly", { count: draftCount })}
                  </FilterChip>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sticky footer: chips no longer close the sheet per tap (uniform
                behaviour — type/flagged chips never did, year/draft chips used to),
                so batch review + a single "Clear all" replaces closing on selection. */}
        <div className="sticky bottom-0 -mx-5 mt-4 border-t border-border bg-background px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            onClick={clearAllFilters}
            disabled={sheetFilterCount === 0}
            className="w-full rounded-md border border-border bg-card py-2.5 text-sm font-semibold text-foreground disabled:opacity-40"
          >
            {t("filterClearAll")}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );

  return (
    <TableToolbar
      filters={
        <div className={TOOLBAR_FILTERS_DESKTOP_ONLY}>
          {typeChips}
          {yearOptions.length > 1 && (
            <YearFilterDropdown
              value={yearFilterProp}
              options={yearOptions}
              onChange={(y) => onNavigateWithParam("year", y ?? undefined)}
              label={t("filterYear")}
              allLabel={t("allYears")}
            />
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
      }
      search={
        <ToolbarSearch
          value={localQuery}
          onChange={handleSearchChange}
          placeholder={t("searchPlaceholder")}
          clearLabel={t("searchClear")}
        />
      }
      actions={
        <>
          {filterSheetTrigger}
          {actions}
        </>
      }
    />
  );
}

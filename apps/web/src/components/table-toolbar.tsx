"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Standard shape for a table's filter/search/actions row (Activity, Trades, Income,
 * Holdings): filter chips left, search + actions right of them, flipping from a stacked
 * mobile layout to one row at `md:`. `md:` is deliberate, not a leftover from Activity's
 * mobile filter Sheet — it's the same mobile/desktop boundary `PageTitle` (`md:hidden`)
 * and the desktop topbar (`md:flex`) already use.
 */
export function TableToolbar({
  filters,
  search,
  actions,
}: {
  filters: React.ReactNode;
  search?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm md:flex-row md:items-center">
      {filters}
      {(search || actions) && (
        <div className="flex shrink-0 items-center gap-2 md:ml-auto">
          {search}
          {actions}
        </div>
      )}
    </div>
  );
}

/**
 * Filters-wrapper class for toolbars whose chips stay visible (and horizontally scroll)
 * on mobile — Trades, Income, Holdings. `min-w-0` lets this shrink instead of squeezing
 * the search input when there are many pills inside a narrow main column.
 */
export const TOOLBAR_FILTERS =
  "flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] " +
  "md:flex-wrap md:overflow-visible md:pb-0 [&::-webkit-scrollbar]:hidden";

/**
 * Filters-wrapper class for toolbars whose mobile chips live in a filter `Sheet` instead
 * (Activity) — hidden below `md`, where the Sheet trigger takes over.
 */
export const TOOLBAR_FILTERS_DESKTOP_ONLY = "hidden min-w-0 flex-wrap items-center gap-2 md:flex";

/**
 * The search input shared by every toolbar: icon + input + conditional clear button.
 * Deliberately dumb/controlled — callers own their own state (and, for Activity, the
 * debounce + URL-param navigation on top of it).
 */
export function ToolbarSearch({
  value,
  onChange,
  placeholder,
  clearLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  clearLabel: string;
  className?: string;
}) {
  return (
    <div className={cn("relative flex flex-1 items-center md:flex-none", className)}>
      <Search className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full pl-7 pr-7 text-xs md:h-8 md:w-56"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={clearLabel}
          className="absolute right-2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

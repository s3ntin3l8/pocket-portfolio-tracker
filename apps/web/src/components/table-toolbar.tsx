"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Standard shape for a table's filter/search/actions row (Activity, Trades, Income,
 * Holdings): filter chips left, search + actions right of them, flipping from a stacked
 * mobile layout to one row at `md:`. `md:` is deliberate, not a leftover from Activity's
 * mobile filter Sheet — it's the same mobile/desktop boundary `PageHeader`'s heading
 * (`md:sr-only`) and the desktop topbar (`md:flex`) already use.
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
 * on mobile — Trades, Income, Holdings (with the edge scroll shadow, audit G5). From `md:`
 * it takes the row's remaining width (`flex-1 min-w-0`) and wraps onto further lines, so the
 * chips can never run underneath the fixed-size search box beside them.
 */
export const TOOLBAR_FILTERS =
  "scroll-shadow-x flex min-w-0 items-center gap-2 pb-0.5 [--scroll-shadow-bg:var(--background)] " +
  "[scrollbar-width:none] md:flex-1 md:flex-wrap md:overflow-visible md:bg-none md:pb-0 " +
  "[&::-webkit-scrollbar]:hidden";

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
        aria-label={placeholder}
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
          className="absolute right-2 text-muted-foreground before:absolute before:-inset-3 hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

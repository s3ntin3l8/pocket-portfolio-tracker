"use client";

import { ChevronDown, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CHIP_BASE, CHIP_ACTIVE, CHIP_INACTIVE } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Shared filter-bar building blocks for the table toolbars (Activity, Trades). The layout
 * shell (chips left, search/actions right) is `TableToolbar`; these are the pieces both
 * toolbars used to hand-roll identically. Filter *state* stays with each table.
 */

/** A pill toggle: `aria-pressed` + the shared active/inactive chip classes. */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_INACTIVE)}
    >
      {children}
    </button>
  );
}

/** Year picker dropdown: "all" + the given years; `value` null/undefined means all. */
export function YearFilterDropdown({
  value,
  options,
  onChange,
  label,
  allLabel,
}: {
  value: string | null | undefined;
  options: string[];
  onChange: (year: string | null) => void;
  label: string;
  allLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card pl-3 pr-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {value ?? allLabel}
          <ChevronDown className="size-3.5 shrink-0 text-text-2" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        {["all", ...options].map((y) => (
          <DropdownMenuItem
            key={y}
            onSelect={() => onChange(y === "all" ? null : y)}
            className="justify-between gap-3"
          >
            {y === "all" ? allLabel : y}
            {(y === "all" ? !value : value === y) && <Check className="size-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

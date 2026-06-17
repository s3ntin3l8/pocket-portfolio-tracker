import * as React from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import type { SortDir } from "@/lib/table-sort";

export interface SortableTableHeadProps {
  colKey: string;
  sortKey: string | null;
  sortDir: SortDir;
  onToggle: (key: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function SortableTableHead({
  colKey,
  sortKey,
  sortDir,
  onToggle,
  children,
  className,
}: SortableTableHeadProps) {
  const isActive = colKey === sortKey;
  const ariaSortValue = isActive
    ? sortDir === "asc"
      ? "ascending"
      : "descending"
    : "none";

  return (
    <TableHead
      aria-sort={ariaSortValue}
      className={`cursor-pointer select-none ${className ?? ""}`}
    >
      <button
        type="button"
        className="flex items-center gap-1 hover:text-foreground"
        onClick={() => onToggle(colKey)}
      >
        {children}
        {isActive ? (
          sortDir === "asc" ? (
            <ChevronUp className="size-3 shrink-0" />
          ) : (
            <ChevronDown className="size-3 shrink-0" />
          )
        ) : (
          <ChevronsUpDown className="size-3 shrink-0" />
        )}
      </button>
    </TableHead>
  );
}

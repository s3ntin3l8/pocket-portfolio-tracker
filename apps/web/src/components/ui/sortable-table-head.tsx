import * as React from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Info } from "lucide-react";
import { TableHead } from "@/components/ui/table";
import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { SortDir } from "@/lib/table-sort";

export interface SortableTableHeadProps {
  colKey: string;
  sortKey: string | null;
  sortDir: SortDir;
  onToggle: (key: string) => void;
  children: React.ReactNode;
  className?: string;
  align?: "left" | "right";
  /** Explanatory hint: rendered as a sibling info control beside (never inside) the sort button. */
  hint?: string;
}

export function SortableTableHead({
  colKey,
  sortKey,
  sortDir,
  onToggle,
  children,
  className,
  align = "left",
  hint,
}: SortableTableHeadProps) {
  const isActive = colKey === sortKey;
  const ariaSortValue = isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  return (
    <TableHead
      aria-sort={ariaSortValue}
      className={cn("cursor-pointer select-none", align === "right" && "text-right", className)}
    >
      {hint ? (
        <div className={cn("flex items-center gap-1", align === "right" && "justify-end")}>
          <button
            type="button"
            className={cn(
              "flex items-center gap-1 hover:text-foreground",
              isActive && "text-foreground",
            )}
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
          <InfoTip label={hint}>
            <button type="button" aria-label={hint} className="inline-flex shrink-0 rounded-full">
              <Info className="size-3 text-muted-foreground" aria-hidden />
            </button>
          </InfoTip>
        </div>
      ) : (
        <button
          type="button"
          className={cn(
            "flex items-center gap-1 hover:text-foreground",
            isActive && "text-foreground",
            align === "right" && "w-full justify-end",
          )}
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
      )}
    </TableHead>
  );
}

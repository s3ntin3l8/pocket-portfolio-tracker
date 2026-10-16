import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `edgeAffordance` (audit G5) opts a wide table into the scroll-shadow wrapper
 * (`scroll-shadow-x`, shadows appear only on an edge with more content past it) and a
 * pinned first column (`sticky-first-col`), so horizontal overflow is never silent.
 */
function Table({
  className,
  edgeAffordance = false,
  ...props
}: React.ComponentProps<"table"> & { edgeAffordance?: boolean }) {
  return (
    <div className={cn("relative w-full overflow-x-auto", edgeAffordance && "scroll-shadow-x")}>
      <table
        className={cn(
          "w-full caption-bottom text-body-sm",
          edgeAffordance && "sticky-first-col",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn(
        "border-t-2 border-line bg-card-2 text-sm font-bold [&_tr]:border-0",
        className,
      )}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn("border-b border-line transition-colors hover:bg-row-hover", className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "h-11 px-3 text-left align-middle text-xs font-medium text-muted-foreground first:pl-5 last:pr-5 [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

/** `numeric` right-aligns the cell with tabular figures — the one spelling for a money or
 *  quantity column (compose weight/colour via `className`). */
function TableCell({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "px-3 py-3 align-middle first:pl-5 last:pr-5",
        numeric && "tabular text-right",
        className,
      )}
      {...props}
    />
  );
}

// Shared cell-typography convention (sourced from the Holdings table, the most fully-realized
// instance). Not baked into TableCell itself since weight/role varies by column — compose with
// `cn()` (e.g. `cn(TABLE_VALUE, "text-text-mute")` for a de-emphasized secondary number).
export const TABLE_LABEL = "text-sm font-bold";
export const TABLE_SUBLABEL = "text-xs font-medium text-text-2";
export const TABLE_VALUE = "tabular whitespace-nowrap text-right text-body-sm font-medium";
export const TABLE_VALUE_STRONG = "tabular whitespace-nowrap text-right text-body-sm font-bold";
export const TABLE_SUBVALUE = "text-micro font-semibold";

// Shared filter-chip pill spec, used by the toolbar filter rows above a table (Activity,
// Trades, Income, Holdings' asset-class tabs). Compose with `cn()`:
// `cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_INACTIVE)`.
export const CHIP_BASE = "whitespace-nowrap rounded-full px-3.5 py-[7px] text-xs";
export const CHIP_ACTIVE = "bg-pill font-bold text-white";
export const CHIP_INACTIVE = "border border-border bg-card font-semibold text-foreground";

export { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell };

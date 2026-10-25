import * as React from "react";
import { cn } from "@/lib/utils";
import { StickyTableWrapper } from "@/components/ui/sticky-table-wrapper";

/**
 * `edgeAffordance` (audit G5) opts a wide table into the scroll-shadow wrapper
 * (`scroll-shadow-x`, shadows appear only on an edge with more content past it) and a
 * pinned first column (`sticky-first-col`), so horizontal overflow is never silent.
 *
 * `stickyHeader` pins the header row under the topbar while the shell scrolls. While the table
 * fits its column the wrapper clips instead of scrolling (see `StickyTableWrapper`); when it does
 * not fit it scrolls horizontally and the header scrolls with the page. Do not combine with `edgeAffordance`: the sticky wrapper has its own shadows.
 *
 * `caption` names the table for assistive tech (audit R4-D5): a screen-reader user
 * navigating by table would otherwise meet several indistinguishable "table, 6
 * columns" entries on one page. It is REQUIRED, so a new table cannot be added
 * unnamed, and every call site passes a localized name. It is applied as the
 * table's `aria-label` rather than a `<caption>` element: most of these tables sit
 * under a card whose visible heading already carries the same words, and a second
 * copy of that text in the DOM is noise (a `<caption>` would also repeat the heading
 * in every text query).
 */
function Table({
  className,
  caption,
  edgeAffordance = false,
  stickyHeader = false,
  onStickyChange,
  children,
  ...props
}: React.ComponentProps<"table"> & {
  /** The table's accessible name — localized. Required: a table must be nameable. */
  caption: string;
  edgeAffordance?: boolean;
  stickyHeader?: boolean;
  /** With `stickyHeader`: called when the header starts or stops pinning (the table fits). */
  onStickyChange?: (pinned: boolean) => void;
}) {
  const wrapperClass = cn(
    !stickyHeader && "relative w-full overflow-x-auto",
    edgeAffordance && "scroll-shadow-x",
  );
  const element = (
    <table
      aria-label={caption}
      className={cn(
        "w-full caption-bottom text-body-sm",
        edgeAffordance && "sticky-first-col",
        stickyHeader &&
          "[&_thead_th]:sticky [&_thead_th]:top-(--topbar-h) [&_thead_th]:z-10 [&_thead_th]:bg-card [&_thead_th]:shadow-[inset_0_-1px_0_var(--line)]",
        className,
      )}
      {...props}
    >
      {children}
    </table>
  );
  return stickyHeader ? (
    <StickyTableWrapper className={wrapperClass} onFitChange={onStickyChange}>
      {element}
    </StickyTableWrapper>
  ) : (
    <div className={wrapperClass}>{element}</div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  // No row hover in the header (nor the footer): only body rows are interactive, and a
  // highlighted header row would leave its pinned `sticky-first-col` cell a second tone.
  return (
    <thead className={cn("[&_tr]:border-b [&_tr]:hover:bg-transparent", className)} {...props} />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn(
        "border-t-2 border-line bg-card-2 text-body-sm font-bold [&_tr]:border-0 [&_tr]:hover:bg-transparent",
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
        "h-(--table-head-h) px-3 text-left align-middle text-xs font-medium text-muted-foreground first:pl-5 last:pr-5 [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

/** Right-aligned tabular figures — the one spelling for a money or quantity column. */
export const TABLE_NUMERIC = "tabular text-right";

/** `numeric` right-aligns the cell with tabular figures (`TABLE_NUMERIC`); compose weight and
 *  colour via `className`, which wins over it. It deliberately omits `whitespace-nowrap` so the
 *  `table-fixed` tax tables can still wrap; add it (or use `TABLE_VALUE`) where a figure must
 *  never break. */
function TableCell({
  className,
  numeric = false,
  ...props
}: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "px-3 py-3 align-middle first:pl-5 last:pr-5",
        numeric && TABLE_NUMERIC,
        className,
      )}
      {...props}
    />
  );
}

// Which to reach for: `<TableCell numeric>` for a plain right-aligned figure; `TABLE_VALUE` /
// `TABLE_VALUE_STRONG` for a figure that must never wrap (they add `whitespace-nowrap` and the
// 13px weight) or when the styled node is not a cell (a `<span>`, a footer total).
//
// Shared cell-typography convention (sourced from the Holdings table, the most fully-realized
// instance). Not baked into TableCell itself since weight/role varies by column — compose with
// `cn()` (e.g. `cn(TABLE_VALUE, "text-text-mute")` for a de-emphasized secondary number).
export const TABLE_LABEL = "text-sm font-bold";
export const TABLE_SUBLABEL = "text-xs font-medium text-text-2";
export const TABLE_VALUE = `${TABLE_NUMERIC} whitespace-nowrap text-body-sm font-medium`;
export const TABLE_VALUE_STRONG = `${TABLE_NUMERIC} whitespace-nowrap text-body-sm font-bold`;
export const TABLE_SUBVALUE = "text-micro font-semibold";

// Shared filter-chip pill spec, used by the toolbar filter rows above a table (Activity,
// Trades, Income, Holdings' asset-class tabs). Compose with `cn()`:
// `cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_INACTIVE)`.
export const CHIP_BASE = "whitespace-nowrap rounded-full px-3.5 py-[7px] text-xs";
export const CHIP_ACTIVE = "bg-pill font-bold text-white";
export const CHIP_INACTIVE = "border border-border bg-card font-semibold text-foreground";

export { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell };

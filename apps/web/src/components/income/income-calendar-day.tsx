"use client";

import { useTranslations, useLocale } from "next-intl";
import type { UpcomingPayment } from "@portfolio/api-client";
import { InstrumentLogo } from "@/components/instrument-logo";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DayCell } from "@/lib/calendar";
import { IncomeCalendarDayPopoverContent } from "./income-calendar-day-popover";

/** Number of logos rendered inline in a calendar day cell before falling back to a
 *  "+N more" chip. Picked to fit comfortably inside a 48-px-tall cell with stacked
 *  24×24 logos — a third logo lands cleanly when cells stretch on wide viewports. */
const INLINE_LOGO_LIMIT = 3;

/** Compact 24×24 wrapper around `<InstrumentLogo>` for use inside calendar day cells.
 *  Pumps through the existing `className` so it shrinks the underlying 38×38 frame
 *  plus the rounded mask; keeps full logo/monogram-fallback logic from the canonical
 *  component. */
function CalendarLogo({ payment }: { payment: UpcomingPayment }) {
  const label = payment.displayName ?? payment.name ?? payment.symbol ?? "—";
  return (
    <InstrumentLogo
      label={label}
      symbol={payment.symbol}
      market={payment.market}
      assetClass={payment.assetClass}
      className="!size-6 !rounded-md"
    />
  );
}

/**
 * One cell of the income payment calendar. Non-interactive when the cell is empty
 * or out-of-month; otherwise renders up to {@link INLINE_LOGO_LIMIT} stacked logos
 * and a "+N more" chip for overflow, all inside a Radix popover trigger. The
 * popover opens on click/Enter and renders the full per-day list (see
 * `IncomeCalendarDayPopoverContent`).
 */
export function IncomeCalendarDay({
  cell,
  events,
  currency,
}: {
  cell: DayCell;
  events: UpcomingPayment[];
  currency: string;
}) {
  const t = useTranslations("Income");
  const locale = useLocale();
  const dateLabel = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${cell.dateKey}T00:00:00Z`));

  const visible = events.slice(0, INLINE_LOGO_LIMIT);
  const overflow = events.length - visible.length;
  const interactive = events.length > 0;

  // Day-cell body is always the same JSX so the grid rows align — only the wrapper
  // element swaps between <button> (interactive) and <div> (out-of-month / empty).
  const body = interactive ? (
    <div className="flex w-full flex-col items-start gap-1">
      <div className="flex items-center gap-1">
        {visible.map((p, i) => (
          <CalendarLogo key={`${p.instrumentId}-${p.date}-${i}`} payment={p} />
        ))}
      </div>
      {overflow > 0 && (
        <span
          className="rounded-full bg-muted px-1.5 py-px text-[10px] font-bold tabular text-text-2"
          aria-label={t("calendarMoreAria", { count: overflow })}
        >
          {t("calendarMore", { count: overflow })}
        </span>
      )}
    </div>
  ) : null;

  const cellClass = cn(
    "group relative flex aspect-[1.05/1] min-h-[64px] flex-col gap-1 rounded-lg border border-line bg-card-2 p-1.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    !cell.inMonth && "bg-card opacity-50",
    cell.isToday && "ring-2 ring-primary ring-offset-1 ring-offset-card",
    interactive && "hover:bg-muted/50",
  );

  const dayNumber = (
    <span
      className={cn(
        "tabular text-[11px] font-bold",
        cell.isToday ? "text-primary" : "text-text-2",
        !cell.inMonth && "text-text-mute",
      )}
    >
      {cell.dayOfMonth}
    </span>
  );

  const ariaLabel = interactive
    ? t("calendarDayEvents", { count: events.length }) + " · " + dateLabel
    : dateLabel;

  if (!interactive) {
    return (
      <div role="gridcell" aria-label={ariaLabel} className={cellClass}>
        {dayNumber}
      </div>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="gridcell"
          aria-label={ariaLabel}
          className={cn(cellClass, "cursor-pointer")}
        >
          <div className="flex items-center justify-between">
            {dayNumber}
            {overflow > 0 && (
              <span className="rounded-full bg-muted px-1.5 text-[9px] font-bold tabular text-text-2 sm:hidden">
                +{overflow}
              </span>
            )}
          </div>
          {body}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={6}
        className="w-72 max-w-[calc(100vw-2rem)] p-0"
      >
        <IncomeCalendarDayPopoverContent
          dateKey={cell.dateKey}
          events={events}
          currency={currency}
        />
      </PopoverContent>
    </Popover>
  );
}

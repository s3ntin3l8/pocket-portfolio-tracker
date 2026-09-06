"use client";

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import type { UpcomingPayment } from "@portfolio/api-client";
import { buildMonthGrid } from "@/lib/calendar";
import { IncomeCalendarHeader } from "./income-calendar-header";
import { IncomeCalendarDay } from "./income-calendar-day";

/**
 * Forward-looking monthly wall-calendar visualisation for the Income page. Sits
 * above the existing timeline card; built around the existing
 * `upcoming: UpcomingPayment[]` payload so there are no new API routes.
 *
 * Behaviour:
 * - Defaults the visible month to "the month containing the earliest upcoming
 *   event", or today (UTC) when the array is empty — the latter is handled by
 *   the page (it renders `<IncomeCalendarEmpty/>` instead and never mounts us).
 * - Each day cell renders up to 3 logos + a "+N more" chip; popover lists them
 *   all.
 * - The month grid is rebuilt from the pure `buildMonthGrid` helper on viewMonth
 *   change so cell positions stay correct across locale-aware week starts.
 */
export function IncomeCalendar({
  upcoming,
  currency,
}: {
  upcoming: UpcomingPayment[];
  currency: string;
}) {
  const t = useTranslations("Income");
  const locale = useLocale();

  // Anchor the visible month on the earliest upcoming event so the user opens
  // onto something useful (e.g. next-quarter coupon → next quarter's first
  // month). Fall back to today's month (UTC) when the array is empty
  // (defensive — the page guards this externally). Subsequent user navigation
  // overrides this default until the page remounts.
  const [viewMonth, setViewMonth] = useState<{ year: number; month: number }>(() => {
    const today = new Date();
    if (upcoming.length === 0) {
      return { year: today.getUTCFullYear(), month: today.getUTCMonth() };
    }
    const earliest = [...upcoming].sort((a, b) => a.date.localeCompare(b.date))[0];
    const [y, m] = earliest.date.split("-").map(Number);
    return { year: y, month: m - 1 };
  });

  const grid = useMemo(
    () => buildMonthGrid(viewMonth.year, viewMonth.month, locale),
    [viewMonth, locale],
  );

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(viewMonth.year, viewMonth.month, 1))),
    [viewMonth, locale],
  );

  // Index events by date for O(1) cell lookup. The current month + the next
  // 12 months always contain the relevant events; we hash everything for
  // simplicity — the array is small (typical: tens of items, rare > 200).
  const eventsByDay = useMemo(() => {
    const map = new Map<string, UpcomingPayment[]>();
    for (const e of upcoming) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [upcoming]);

  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  const isCurrentMonth =
    today.getUTCFullYear() === viewMonth.year && today.getUTCMonth() === viewMonth.month;

  function shift(delta: number) {
    setViewMonth(({ year, month }) => {
      const d = new Date(Date.UTC(year, month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
  }

  function jumpToToday() {
    setViewMonth({ year: today.getUTCFullYear(), month: today.getUTCMonth() });
  }

  // Always allow navigation; the calendar is purely forward-looking by data
  // shape (upcoming has no past), but a user may still want to flip back to
  // confirm exactly when a payment lands.
  const canGoPrev = true;
  const canGoNext = true;

  return (
    <div className="rounded-[20px] bg-card p-[22px] shadow-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold">{t("calendarTitle")}</h2>
          <p className="mt-0.5 text-xs font-medium text-text-2">{t("calendarSubtitle")}</p>
        </div>
      </div>

      <div className="space-y-3">
        <IncomeCalendarHeader
          monthLabel={monthLabel}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          isCurrentMonth={isCurrentMonth}
          onPrev={() => shift(-1)}
          onNext={() => shift(1)}
          onToday={jumpToToday}
        />

        <div
          role="grid"
          aria-label={monthLabel}
          className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wide text-text-3"
        >
          {grid.weekdayLabels.map((label, i) => (
            <div key={`${label}-${i}`} role="columnheader" className="pb-1">
              {label}
            </div>
          ))}
          {grid.days.map((cell) => (
            <div key={cell.dateKey} role="presentation">
              <IncomeCalendarDay
                cell={cell}
                events={eventsByDay.get(cell.dateKey) ?? []}
                currency={currency}
              />
            </div>
          ))}
        </div>

        {/* Compact legend — one row of status chips so the calendar stays
            scannable without spelling out the meaning of every paid/announced/
            projected state inline. Mirrors the timeline card's legend styling. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[10px] font-semibold text-text-2">
          <span className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-[3px]"
              style={{
                backgroundColor: "rgba(13,148,136,.16)",
                border: "1.5px solid #0D9488",
              }}
            />
            {t("calendarLegendScheduled")}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-[3px]"
              style={{
                backgroundColor: "rgba(16,163,114,.12)",
                border: "1.5px dashed #0E9F6E",
              }}
            />
            {t("calendarLegendProjected")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[3px] bg-success" />
            {t("calendarLegendPaid")}
          </span>
        </div>
        {/* A hidden marker so a screen-reader user can confirm what today is when
            the today cell isn't in view (we still surface it via the cell grid). */}
        <span className="sr-only">
          {todayKey} · {t("calendarToday")}
        </span>
      </div>
    </div>
  );
}

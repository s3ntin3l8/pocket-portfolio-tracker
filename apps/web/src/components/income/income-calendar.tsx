"use client";

import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";
import type { UpcomingPayment } from "@portfolio/api-client";
import { ChartTooltipPanel } from "@/components/ui/chart-tooltip-panel";
import { useChartTooltip } from "@/components/ui/use-chart-tooltip";
import {
  IncomeCalendarMonthCell,
  type MonthBucket,
  type CalendarTooltipContent,
} from "./income-calendar-month-cell";

/**
 * Rolling 12-month payment calendar — replaces the old day-grid calendar with
 * a compact horizontal strip. All 12 months sit in a single row on desktop;
 * below `@xl` the strip scrolls horizontally with a gradient fade hint.
 *
 * Props are intentionally identical to the old calendar so the page's
 * `upcoming.length > 0` guard still works unchanged.
 */
export function IncomeCalendar({
  upcoming,
  currency: _currency,
}: {
  upcoming: UpcomingPayment[];
  currency: string;
}) {
  const t = useTranslations("Income");
  const locale = useLocale();
  const tip = useChartTooltip<CalendarTooltipContent>();

  const months = useMemo<MonthBucket[]>(() => {
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    const monthFmt = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });

    // Build 12 rolling buckets.
    const buckets: MonthBucket[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(currentYear, currentMonth + i, 1));
      const year = d.getUTCFullYear();
      const monthIdx = d.getUTCMonth();
      const key = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
      buckets.push({
        key,
        label: monthFmt.format(d),
        year,
        isFirstOfYear: monthIdx === 0,
        payments: new Map(),
      });
    }

    // Dispatch upcoming payments into their matching bucket, grouped by instrument.
    for (const p of upcoming) {
      const [y, m] = p.date.split("-").map(Number);
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const bucket = buckets.find((b) => b.key === key);
      if (!bucket) continue;
      const existing = bucket.payments.get(p.instrumentId) ?? [];
      existing.push(p);
      bucket.payments.set(p.instrumentId, existing);
    }

    return buckets;
  }, [upcoming, locale]);

  // Year range label — e.g. "2026–2027" when the strip crosses a year boundary.
  const yearRange = useMemo(() => {
    if (months.length === 0) return "";
    const first = months[0].year;
    const last = months[months.length - 1].year;
    return first === last ? String(first) : `${first}–${last}`;
  }, [months]);

  return (
    <div className="rounded-2xl bg-card p-[22px] shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold">{t("calendarTitle")}</h2>
        <p className="mt-0.5 text-xs font-medium text-text-2">{t("calendarSubtitle")}</p>
      </div>

      {/* ── 12-month horizontal strip ── */}
      <div className="relative">
        {/* Gradient fade on the right edge — hints at scrollable overflow.
            pointer-events-none so it doesn't intercept clicks/scrolls. */}
        <div
          className="pointer-events-none absolute right-0 top-0 bottom-0 z-10 w-8
                     bg-gradient-to-l from-card to-transparent max-md:hidden"
          aria-hidden
        />
        <div className="flex overflow-x-auto scrollbar-none">
          {months.map((m, i) => (
            <IncomeCalendarMonthCell key={m.key} month={m} monthIdx={i} locale={locale} tip={tip} />
          ))}
        </div>
      </div>

      {/* ── Footer: year range ── */}
      <div className="mt-2.5 text-[10px] font-semibold text-text-2">
        <span className="tabular">{yearRange}</span>
      </div>

      {/* ── Tooltip portal ── */}
      {tip.open &&
        tip.content &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: tip.y,
              left: tip.x,
              zIndex: 60,
              pointerEvents: "none",
            }}
          >
            <ChartTooltipPanel
              title={tip.content.title}
              rows={tip.content.rows}
              onSize={tip.setSize}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { CalendarClock } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

/**
 * Empty-state card shown instead of the calendar grid when the user has no
 * upcoming/forecast payments at all. Distinct from "this month has no events"
 * (which still renders the grid — just with empty cells).
 */
export function IncomeCalendarEmpty() {
  const t = useTranslations("Income");
  return (
    <div className="rounded-[20px] bg-card p-[22px] shadow-card">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold">{t("calendarTitle")}</h2>
          <p className="mt-0.5 text-xs font-medium text-text-2">{t("calendarSubtitle")}</p>
        </div>
      </div>
      <EmptyState
        icon={CalendarClock}
        title={t("calendarEmptyTitle")}
        description={t("calendarEmptyBody")}
      />
    </div>
  );
}

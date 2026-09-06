"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Header strip for the income payment calendar — month label centered, prev/next
 * buttons on either side, "today" pill on the right when the visible month isn't
 * the current month. Compact, accessible (all controls keyboard-reachable, aria
 * labels translated), and locale-agnostic — the month label is rendered by the
 * parent component (which owns the locale/formatter).
 */
export function IncomeCalendarHeader({
  monthLabel,
  canGoPrev,
  canGoNext,
  isCurrentMonth,
  onPrev,
  onNext,
  onToday,
}: {
  monthLabel: string;
  canGoPrev: boolean;
  canGoNext: boolean;
  isCurrentMonth: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  const t = useTranslations("Income");
  const buttonClass =
    "inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        aria-label={t("calendarPrev")}
        onClick={onPrev}
        disabled={!canGoPrev}
        className={buttonClass}
      >
        <ChevronLeft className="size-4" />
      </button>
      <div className="min-w-0 flex-1 text-center">
        <span className="text-[15px] font-extrabold tabular">{monthLabel}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {!isCurrentMonth && (
          <button
            type="button"
            onClick={onToday}
            className={cn(
              "h-8 rounded-full border border-border bg-card px-3 text-xs font-semibold transition-colors hover:bg-muted/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            aria-label={t("calendarJumpToday")}
          >
            {t("calendarToday")}
          </button>
        )}
        <button
          type="button"
          aria-label={t("calendarNext")}
          onClick={onNext}
          disabled={!canGoNext}
          className={buttonClass}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

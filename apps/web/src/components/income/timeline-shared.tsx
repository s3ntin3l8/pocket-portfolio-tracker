"use client";

import { useTranslations } from "next-intl";
import type { IncomeEvent, UpcomingPayment } from "@portfolio/api-client";
import { monogram } from "@/lib/brokerages";
import { cn } from "@/lib/utils";
import { tint } from "@/lib/tint";

/** Unified row type: historical events + upcoming payments merged into one table. */
export type IncomeEventRow = IncomeEvent & {
  status?: UpcomingPayment["status"];
  growthApplied?: number;
  assumesContributions?: boolean;
  perShare?: string;
  quantity?: string;
};

export type InstrumentGroup = {
  key: string;
  symbol: string;
  displayName: string | null;
  totalByCurrency: Record<string, number>;
  totalLabel: string;
  hasReceived: boolean;
  hasForecast: boolean;
  dominantType: string;
  rows: IncomeEventRow[];
};

/**
 * Reference "Payments timeline" grid template — shared by the column header
 * (see {@link TimelineColumnHeader}) and every data row so columns line up.
 * Date | Instrument | Type | Shares | Per share | Amount.
 */
export const TIMELINE_GRID = "grid-cols-[76px_minmax(0,1.3fr)_minmax(0,0.9fr)_76px_92px_116px]";

/** Desktop-only column-header row for the payments timeline. */
export function TimelineColumnHeader() {
  const t = useTranslations("Income");
  return (
    <div
      className={cn(
        "hidden gap-3.5 border-b border-line px-0.5 py-2.5 text-micro font-bold uppercase tracking-wide text-text-2 sm:grid",
        TIMELINE_GRID,
      )}
    >
      <div>{t("date")}</div>
      <div>{t("instrument")}</div>
      <div>{t("type")}</div>
      <div className="text-right">{t("shares")}</div>
      <div className="text-right">{t("perShare")}</div>
      <div className="text-right">{t("amount")}</div>
    </div>
  );
}

/** 36×36 rounded-square badge; dashed outline for forecast rows (reference).
 *  Tinted by payment type — green for dividends, teal for coupons/interest. */
export function TimelineBadge({
  label,
  type,
  forecast,
}: {
  label: string;
  type: string;
  forecast: boolean;
}) {
  const tone =
    type === "coupon" || type === "interest" ? { ...tint("teal") } : { ...tint("primary") };
  return (
    <span
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-micro font-bold"
      style={
        forecast
          ? { backgroundColor: "transparent", color: tone.fg, border: `1.5px dashed ${tone.fg}` }
          : { backgroundColor: tone.bg, color: tone.fg }
      }
      aria-hidden
    >
      {monogram(label)}
    </span>
  );
}

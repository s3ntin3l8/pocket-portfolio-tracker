"use client";

import { useTranslations, useLocale } from "next-intl";
import type { UpcomingPayment } from "@portfolio/api-client";
import { InstrumentLogo } from "@/components/instrument-logo";
import { formatMoney } from "@/lib/utils";

const STATUS_TONES: Record<UpcomingPayment["status"], { fg: string; bg: string }> = {
  scheduled: { fg: "#0D9488", bg: "rgba(13,148,136,.14)" },
  projected: { fg: "#0E9F6E", bg: "rgba(16,163,114,.12)" },
  grown: { fg: "#0E9F6E", bg: "rgba(16,163,114,.12)" },
  announced: { fg: "#0E9F6E", bg: "rgba(16,163,114,.12)" },
  paid: { fg: "#0E9F6E", bg: "rgba(16,163,114,.14)" },
};

/**
 * Body of the per-day popover for the income calendar. Lists every payment on the
 * open date with its logo, name, amount (native currency), and a status badge —
 * plus a sticky footer with the per-day count and total so a busy day stays
 * scannable when more than 3 logos overflowed the cell into "+N".
 */
export function IncomeCalendarDayPopoverContent({
  dateKey,
  events,
  currency,
}: {
  dateKey: string;
  events: UpcomingPayment[];
  currency: string;
}) {
  const t = useTranslations("Income");
  const tt = useTranslations("TxType");
  const locale = useLocale();
  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T00:00:00Z`));

  // Sort by amount (in native currency) descending so the largest payment leads.
  const sorted = [...events].sort((a, b) => Number(b.amount) - Number(a.amount));
  const total = events.reduce((acc, e) => acc + Number(e.amount), 0);
  const mixedCurrencies = new Set(events.map((e) => e.currency)).size > 1;

  return (
    <div className="flex max-h-[60vh] flex-col">
      <header className="border-b border-line bg-card-2 px-3.5 py-2.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-text-3">{dateLabel}</p>
        <p className="mt-0.5 text-xs font-semibold text-text-2">
          {t("calendarDayEvents", { count: events.length })}
          {" · "}
          <span className="tabular text-foreground">
            {mixedCurrencies ? t("calendarDayTotal") : formatMoney(total, currency, locale)}
          </span>
        </p>
      </header>
      <ul className="flex-1 overflow-y-auto px-1.5 py-1.5">
        {sorted.map((e, i) => {
          const label = e.displayName ?? e.name ?? e.symbol ?? "—";
          const tone = STATUS_TONES[e.status];
          const statusKey =
            `calendarLegend${e.status.charAt(0).toUpperCase() + e.status.slice(1)}` as const;
          return (
            <li
              key={`${e.instrumentId}-${e.date}-${i}`}
              className="flex items-start gap-2.5 rounded-md px-2 py-2 hover:bg-muted/40"
            >
              <InstrumentLogo
                label={label}
                symbol={e.symbol}
                market={e.market}
                assetClass={e.assetClass}
                className="!size-8 !rounded-md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold" title={label}>
                  {label}
                </p>
                <p className="truncate text-[11px] font-medium text-text-2">{tt(e.kind)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="tabular whitespace-nowrap text-[13px] font-bold text-foreground">
                  {formatMoney(Number(e.amount), e.currency, locale)}
                </span>
                <span
                  className="rounded-full px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wide"
                  style={{ backgroundColor: tone.bg, color: tone.fg }}
                >
                  {t(statusKey)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

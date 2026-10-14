"use client";

import { useTranslations } from "next-intl";
import type { UpcomingPayment } from "@portfolio/api-client";
import { InstrumentLogo } from "@/components/instrument-logo";
import type { ChartTooltipRow } from "@/components/ui/chart-tooltip-panel";
import { useChartTooltip } from "@/components/ui/use-chart-tooltip";
import { cn, formatMoney } from "@/lib/utils";

export type CalendarTooltipContent = { title: string; rows: ChartTooltipRow[] };
export type CalendarTooltip = ReturnType<typeof useChartTooltip<CalendarTooltipContent>>;

/** Best-available display label for a payment row — clean display name, falling back
 *  to the raw instrument name, then the bare ticker. */
function paymentLabel(payment: Pick<UpcomingPayment, "displayName" | "name" | "symbol">) {
  return payment.displayName ?? payment.name ?? payment.symbol ?? "—";
}

const STATUS_DOTS: Record<UpcomingPayment["status"], string> = {
  scheduled: "var(--chart-3)",
  announced: "var(--info)",
  projected: "var(--warning)",
  grown: "var(--violet)",
  paid: "var(--success)",
};

export type MonthBucket = {
  key: string;
  label: string;
  year: number;
  isFirstOfYear: boolean;
  payments: Map<string, UpcomingPayment[]>;
};

function MonthLogo({
  payments,
  locale,
  tip,
}: {
  payments: UpcomingPayment[];
  locale: string;
  tip: CalendarTooltip;
}) {
  const t = useTranslations("Income");
  const rep = payments[0];
  const label = paymentLabel(rep);

  const rows: ChartTooltipRow[] = [...payments]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => {
      const dateStr = new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(new Date(`${p.date}T00:00:00Z`));
      const statusKey =
        `calendarLegend${p.status.charAt(0).toUpperCase() + p.status.slice(1)}` as const;
      return {
        label: `${dateStr} · ${t(statusKey)}`,
        value: formatMoney(Number(p.amount), p.currency, locale),
        dot: STATUS_DOTS[p.status],
      };
    });

  const isProjected = payments.some((p) => p.status === "projected" || p.status === "grown");

  const listeners = tip.bind({ title: label, rows });

  return (
    <button
      type="button"
      {...listeners}
      aria-label={`${label} — ${t("calendarDayEvents", { count: payments.length })}`}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-md bg-muted transition-opacity",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isProjected && "opacity-60",
      )}
    >
      <InstrumentLogo
        label={label}
        symbol={rep.symbol}
        market={rep.market}
        assetClass={rep.assetClass}
        className="!size-5 !rounded-md"
      />
    </button>
  );
}

export function IncomeCalendarMonthCell({
  month,
  monthIdx,
  locale,
  tip,
}: {
  month: MonthBucket;
  monthIdx: number;
  locale: string;
  tip: CalendarTooltip;
}) {
  return (
    <div className={cn("min-w-[58px] flex-1 text-center", monthIdx > 0 && "border-r border-line")}>
      <p className="text-micro font-bold leading-tight text-text-2">
        {month.label}
        {month.isFirstOfYear && (
          <span className="text-text-mute"> &apos;{String(month.year).slice(2)}</span>
        )}
      </p>
      <div className="mt-1.5 flex flex-wrap justify-center gap-1">
        {[...month.payments.entries()].map(([instrumentId, payments]) => (
          <MonthLogo key={instrumentId} payments={payments} locale={locale} tip={tip} />
        ))}
      </div>
      {month.payments.size === 0 && <p className="mt-2.5 text-micro text-text-mute">—</p>}
    </div>
  );
}

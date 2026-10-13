import { useTranslations } from "next-intl";
import type { GoldPlan } from "@portfolio/api-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TABLE_VALUE,
} from "@/components/ui/table";
import { formatMoney, formatQuantity } from "@/lib/utils";

function formatDate(date: string, locale: string): string {
  // Date-only keys are calendar dates, not instants: pin to UTC so they never shift a day.
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

function Fact({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-text-2">{label}</dt>
      <dd className={`tabular mt-0.5 truncate text-sm font-bold ${muted ? "text-text-2" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

/**
 * One financed gold-purchase (cicilan) plan: progress through the installments, what is
 * still owed, the next installment, the gold's current buyback value, and the full schedule
 * (a native `<details>`, so it stays a server component). Contract amounts are in the
 * contract's own currency; the buyback value is in the display currency.
 */
export function GoldPlanCard({
  plan,
  title,
  displayCurrency,
  locale,
}: {
  plan: GoldPlan;
  /** The gold's name (from its holding); falls back to the contract number. */
  title: string | null;
  displayCurrency: string;
  locale: string;
}) {
  const t = useTranslations("GoldReport");
  const money = (v: string | number) => formatMoney(Number(v), plan.currency, locale);
  const total = Math.max(plan.tenorMonths, plan.schedule.length, 1);
  const pct = Math.min(100, Math.round((plan.paidCount / total) * 100));
  const overdue = plan.nextDue?.overdue === true;

  const status = plan.completed
    ? { label: t("statusCompleted"), variant: "success" as const }
    : overdue
      ? { label: t("statusOverdue"), variant: "destructive" as const }
      : { label: t("statusOnTrack"), variant: "default" as const };

  const valueText =
    plan.fxMissing || plan.value === null
      ? "—"
      : formatMoney(Number(plan.value), displayCurrency, locale);

  return (
    <Card>
      <CardContent className="space-y-4 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold">
              {title ?? plan.contractNo ?? t("planFallbackTitle")}
            </h3>
            <p className="text-xs text-text-2">
              {[plan.provider, plan.contractNo].filter(Boolean).join(" · ")}
              {plan.provider || plan.contractNo ? " · " : ""}
              {t("started", { date: formatDate(plan.startDate, locale) })}
            </p>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>

        <div>
          <div className="flex items-baseline justify-between text-xs font-semibold text-text-2">
            <span>{t("progress", { paid: plan.paidCount, total })}</span>
            <span className="tabular">{pct}%</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={plan.paidCount}
            aria-label={t("progress", { paid: plan.paidCount, total })}
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={`h-full rounded-full ${plan.completed ? "bg-success" : "bg-primary"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 @lg:grid-cols-4">
          <Fact
            label={t("planGrams")}
            value={formatQuantity(Number(plan.grams), "grams", locale)}
          />
          <Fact label={t("planValue")} value={valueText} muted={plan.valuedAtCost} />
          <Fact label={t("planOutstanding")} value={money(plan.outstandingPrincipal)} />
          <Fact label={t("planMonthly")} value={money(plan.monthlyInstallment)} />
          <Fact
            label={t("planPaid")}
            value={money(Number(plan.paidPrincipal) + Number(plan.paidMargin))}
          />
          <Fact label={t("planPurchase")} value={money(plan.purchasePrice)} />
          <Fact label={t("planDown")} value={money(plan.downPayment)} />
          <Fact label={t("planMargin")} value={money(plan.marginTotal)} />
        </dl>
        {plan.valuedAtCost && <p className="text-xs text-text-2">{t("valuedAtCostNote")}</p>}

        {plan.nextDue && (
          <p
            className={`rounded-md border px-3 py-2 text-sm ${
              overdue ? "border-destructive/40 bg-destructive/10 text-destructive" : "bg-muted/40"
            }`}
          >
            <span className="font-semibold">{overdue ? t("nextOverdue") : t("nextDue")}</span>{" "}
            {t("nextDueDetail", {
              n: plan.nextDue.n,
              date: formatDate(plan.nextDue.dueDate, locale),
              amount: money(plan.nextDue.amount),
            })}
          </p>
        )}

        {plan.schedule.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold text-primary">
              {t("scheduleToggle")}
            </summary>
            <div className="mt-2 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colNumber")}</TableHead>
                    <TableHead>{t("colDue")}</TableHead>
                    <TableHead className="text-right">{t("colPrincipal")}</TableHead>
                    <TableHead className="text-right">{t("colMargin")}</TableHead>
                    <TableHead className="text-right">{t("colTotal")}</TableHead>
                    <TableHead>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.schedule.map((r) => (
                    <TableRow key={r.n}>
                      <TableCell className="tabular">{r.n}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(r.dueDate, locale)}
                      </TableCell>
                      <TableCell className={TABLE_VALUE}>{money(r.pokok)}</TableCell>
                      <TableCell className={TABLE_VALUE}>{money(r.sewaModal)}</TableCell>
                      <TableCell className={TABLE_VALUE}>{money(r.angsuran)}</TableCell>
                      <TableCell>
                        <Badge variant={r.paid ? "success" : r.overdue ? "destructive" : "outline"}>
                          {r.paid ? t("rowPaid") : r.overdue ? t("rowOverdue") : t("rowUpcoming")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

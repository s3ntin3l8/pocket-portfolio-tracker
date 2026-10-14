"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { apiErrorCode } from "@portfolio/api-client";
import { useRouter } from "@/i18n/navigation";
import { useApiClient } from "@/lib/api";
import { formatMoney } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The caller's "today" as a `YYYY-MM-DD` key in the browser's own calendar. */
function todayKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Pay a cicilan plan off early (one repayment for the remaining principal, plus optional
 * fees), or undo that payoff. The plan card stays a server component; this is its one
 * interactive island, and every mutation re-runs the server loaders via `router.refresh()`.
 */
export function GoldPlanActions({
  portfolioId,
  loanId,
  currency,
  outstanding,
  closedAt,
  completed,
}: {
  portfolioId: string;
  loanId: string;
  currency: string;
  /** Remaining principal, in the contract's currency. */
  outstanding: string;
  closedAt: string | null;
  completed: boolean;
}) {
  const t = useTranslations("GoldReport");
  const locale = useLocale();
  const router = useRouter();
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState(todayKey);
  const [fees, setFees] = useState("");

  const fail = (err: unknown) => {
    const code = apiErrorCode(err);
    toast.error(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.generic"));
  };

  async function payoff() {
    setBusy(true);
    try {
      await api.payoffLoan(portfolioId, loanId, { date, ...(fees ? { fees } : {}) });
      toast.success(t("paidOff"));
      setOpen(false);
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    try {
      await api.reopenLoan(portfolioId, loanId);
      toast.success(t("reopened"));
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  if (closedAt) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-text-2">
          {t("paidOffOn", {
            date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(
              new Date(`${closedAt}T00:00:00Z`),
            ),
          })}
        </span>
        <Button variant="outline" size="sm" onClick={reopen} disabled={busy}>
          {t("reopenAction")}
        </Button>
      </div>
    );
  }
  if (completed || Number(outstanding) <= 0) return null;

  return (
    <>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t("payoffAction")}
        </Button>
      </div>
      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title={t("payoffTitle")}
        description={t("payoffBody", {
          amount: formatMoney(Number(outstanding), currency, locale),
        })}
        confirmLabel={t("payoffConfirm")}
        variant="default"
        busy={busy}
        confirmDisabled={!date}
        onConfirm={payoff}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={`payoff-date-${loanId}`}>{t("payoffDate")}</Label>
            <Input
              id={`payoff-date-${loanId}`}
              type="date"
              value={date}
              max={todayKey()}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`payoff-fees-${loanId}`}>{t("payoffFees")}</Label>
            <Input
              id={`payoff-fees-${loanId}`}
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={fees}
              onChange={(e) => setFees(e.target.value.replace(",", "."))}
            />
          </div>
        </div>
      </ConfirmActionDialog>
    </>
  );
}

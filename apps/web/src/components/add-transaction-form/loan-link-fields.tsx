"use client";

import type { LoanOption } from "@portfolio/api-client";
import { useLocale } from "next-intl";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { formatDate } from "@/lib/utils";

const loanLabel = (l: LoanOption) =>
  [l.provider, l.contractNo].filter(Boolean).join(" · ") || l.loanId.slice(0, 8);

/**
 * Ties a manual loan repayment to a cicilan loan and, optionally, one of its schedule
 * installments (so the Gold plan shows it paid and the daily job doesn't book it again).
 * An installment the schedule itself booked keeps its link read-only.
 */
export function LoanLinkFields({
  loans,
  selectedLoan,
  loanId,
  onLoanChange,
  installmentN,
  onInstallmentChange,
  locked,
  t,
}: {
  loans: LoanOption[];
  selectedLoan: LoanOption | null;
  loanId: string;
  onLoanChange: (id: string) => void;
  installmentN: number | null;
  onInstallmentChange: (n: number | null) => void;
  locked: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const locale = useLocale();
  // A row being edited may belong to a loan that has since been paid off.
  const options = selectedLoan && !loans.includes(selectedLoan) ? [selectedLoan, ...loans] : loans;
  const installmentOptions = (selectedLoan?.installments ?? []).filter(
    (i) =>
      i.n === installmentN ||
      i.status === "upcoming" ||
      i.status === "overdue" ||
      i.status === "skipped",
  );

  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField label={t("loan")} id="tx-loan">
        <Select
          id="tx-loan"
          value={loanId}
          disabled={locked}
          onChange={(e) => onLoanChange(e.target.value)}
        >
          <option value="">{t("loanNone")}</option>
          {options.map((l) => (
            <option key={l.loanId} value={l.loanId}>
              {loanLabel(l)}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label={t("installment")} id="tx-installment">
        <Select
          id="tx-installment"
          value={installmentN ?? ""}
          disabled={locked || !loanId}
          onChange={(e) => onInstallmentChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{t("installmentNone")}</option>
          {installmentOptions.map((i) => (
            <option key={i.n} value={i.n}>
              {t("installmentOption", { n: i.n, date: formatDate(i.dueDate, locale) })}
            </option>
          ))}
        </Select>
      </FormField>
      {locked && <p className="col-span-2 text-xs text-muted-foreground">{t("loanLinkLocked")}</p>}
    </div>
  );
}

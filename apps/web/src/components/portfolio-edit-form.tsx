"use client";

import { ErrorBanner } from "@/components/ui/error-banner";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import {
  TrConnectionSection,
  IbkrConnectionSection,
} from "@/components/portfolio-form-dialog/sections/connection-section";
import { PortfolioFormSections } from "@/components/portfolio-form-dialog/sections/form-sections";
import { usePortfolioForm } from "@/components/portfolio-form-dialog/hooks";
import type { EditablePortfolio } from "@/components/portfolio-form-dialog/constants";

export function PortfolioEditForm({
  mode,
  portfolio,
}: {
  mode: "create" | "edit";
  portfolio?: EditablePortfolio;
}) {
  const t = useTranslations("PortfolioForm");
  const router = useRouter();
  const f = usePortfolioForm(
    mode,
    portfolio,
    mode === "edit" ? () => router.push("/settings/portfolios") : undefined,
  );
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    f.onOpenChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (deleting && !f.busy && !f.error) router.push("/settings/portfolios");
  }, [deleting, f.busy, f.error, router]);

  function handleDelete() {
    setDeleting(true);
    f.onDelete();
  }

  return (
    <div className="max-w-xl space-y-3.5">
      {f.error && <ErrorBanner>{t("error")}</ErrorBanner>}

      {(f.showTrSection || f.showIbkrSection) && (
        <div className="space-y-3.5">
          {f.showTrSection && (
            <TrConnectionSection
              trConnection={f.trConnection}
              effectivePortfolio={{ id: f.effectivePortfolio!.id }}
              cashCounted={f.cashCounted}
              boundElsewhere={f.boundElsewhere}
              trInitForFlow={f.trInitForFlow}
              client={f.api}
              onRefresh={() => f.router.refresh()}
              onFetchTrigger={() => f.setTrFetchSeq((s) => s + 1)}
            />
          )}

          {f.showIbkrSection && (
            <IbkrConnectionSection
              ibkrConnection={f.ibkrConnection}
              effectivePortfolio={{ id: f.effectivePortfolio!.id }}
              client={f.api}
              onRefresh={() => f.router.refresh()}
              onFetchTrigger={() => f.setIbkrFetchSeq((s) => s + 1)}
            />
          )}
        </div>
      )}

      <form onSubmit={f.submit} className="space-y-3.5">
        <PortfolioFormSections
          name={f.name}
          brokerage={f.brokerage}
          accountHolderId={f.accountHolderId}
          holders={f.holders}
          newHolderName={f.newHolderName}
          newHolderType={f.newHolderType}
          newHolderBirthYear={f.newHolderBirthYear}
          isTr={f.isTr}
          showTrChildNote={f.showTrChildNote}
          effectivePortfolio={f.effectivePortfolio}
          accountNumber={f.accountNumber}
          iban={f.iban}
          currency={f.currency}
          taxAllowanceAnnual={f.taxAllowanceAnnual}
          showFsaHelper={f.showFsaHelper}
          fsaOverAllocated={f.fsaOverAllocated}
          totalAllocated={f.totalAllocated}
          holderAllowanceCap={f.holderAllowanceCap}
          fsaRemainingForHolder={f.fsaRemainingForHolder}
          selectedHolderName={f.selectedHolderObj?.name ?? null}
          cashCounted={f.cashCounted}
          allowNegativeCash={f.allowNegativeCash}
          documentRetention={f.documentRetention}
          onNameChange={f.setName}
          onBrokerageChange={f.setBrokerage}
          onAccountHolderChange={f.setAccountHolderId}
          onNewHolderNameChange={f.setNewHolderName}
          onNewHolderTypeChange={f.setNewHolderType}
          onNewHolderBirthYearChange={f.setNewHolderBirthYear}
          onAccountNumberChange={f.setAccountNumber}
          onIbanChange={f.setIban}
          onCurrencyChange={f.setCurrency}
          onTaxAllowanceChange={f.setTaxAllowanceAnnual}
          onCashCountedChange={f.setCashCounted}
          onAllowNegativeCashChange={f.setAllowNegativeCash}
          onDocumentRetentionChange={f.setDocumentRetention}
        />

        <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:items-center sm:justify-end">
          {mode === "edit" &&
            (f.confirmDelete ? (
              <div className="flex flex-col gap-1.5 sm:mr-auto">
                <Button
                  type="button"
                  onClick={handleDelete}
                  disabled={f.busy}
                  className="h-auto w-full rounded-sm bg-destructive px-4 py-2.5 text-body-sm font-bold text-white hover:bg-destructive/95 dark:hover:bg-destructive/90 sm:w-auto"
                >
                  {f.busy && <Spinner size="sm" />}
                  {t("confirmDelete")}
                </Button>
                <p className="text-micro font-medium text-text-2">
                  {t("deleteWarning", { count: portfolio?.transactionCount ?? 0 })}{" "}
                  {t("deleteRelatedNote")}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => f.setConfirmDelete(true)}
                disabled={f.busy}
                className="text-sm font-bold text-destructive sm:mr-auto"
              >
                {t("delete")}
              </button>
            ))}

          {mode === "create" && f.createdPortfolio ? (
            <Button
              type="button"
              onClick={() => router.push("/settings/portfolios")}
              className="h-auto w-full rounded-lg py-[15px] text-body font-bold sm:w-auto sm:rounded-sm sm:px-[22px] sm:py-[11px]"
            >
              {t("done")}
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={f.busy || !f.name.trim()}
              className="h-auto w-full rounded-lg py-[15px] text-body font-bold sm:w-auto sm:rounded-sm sm:px-[22px] sm:py-[11px]"
            >
              {f.busy && <Spinner size="sm" />}
              {f.busy
                ? mode === "edit"
                  ? t("saving")
                  : t("creating")
                : mode === "edit"
                  ? t("save")
                  : t("create")}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

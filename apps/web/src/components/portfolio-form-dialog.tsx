"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { EditablePortfolio } from "./portfolio-form-dialog/constants";
export type { EditablePortfolio } from "./portfolio-form-dialog/constants";
import { PortfolioFormSections } from "./portfolio-form-dialog/sections/form-sections";
import {
  TrConnectionSection,
  IbkrConnectionSection,
} from "./portfolio-form-dialog/sections/connection-section";
import { usePortfolioForm } from "./portfolio-form-dialog/hooks";

export function PortfolioFormDialog({
  mode,
  portfolio,
  trigger,
  onSuccess,
}: {
  mode: "create" | "edit";
  portfolio?: EditablePortfolio;
  trigger: React.ReactNode;
  onSuccess?: () => void;
}) {
  const t = useTranslations("PortfolioForm");
  const subtitleId = useId();
  const f = usePortfolioForm(mode, portfolio, onSuccess);

  return (
    <Sheet open={f.open} onOpenChange={f.onOpenChange} dismissible={false}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        aria-describedby={subtitleId}
        onInteractOutside={(e) => e.preventDefault()}
        onFocusOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="pb-0">
          <SheetTitle>{mode === "edit" ? t("editTitle") : t("createTitle")}</SheetTitle>
          <p id={subtitleId} className="text-xs font-medium text-text-2">
            {t("subtitle")}
          </p>
        </SheetHeader>

        <form onSubmit={f.submit} className="space-y-4 p-6 pt-4">
          {f.error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="size-4 shrink-0" />
              {t("error")}
            </div>
          )}

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
            documentRetention={f.documentRetention}
            includeInAggregate={f.includeInAggregate}
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
            onDocumentRetentionChange={f.setDocumentRetention}
            onIncludeInAggregateChange={f.setIncludeInAggregate}
          />

          <div className="sticky bottom-0 -mx-6 bg-background border-t border-border px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] z-[2]">
            {mode === "create" && f.createdPortfolio ? (
              <Button
                type="button"
                onClick={() => f.setOpen(false)}
                className="h-auto w-full rounded-[15px] py-[15px] text-[15px] font-bold"
              >
                {t("done")}
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={f.busy || !f.name.trim()}
                className="h-auto w-full rounded-[15px] py-[15px] text-[15px] font-bold"
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

            {mode === "edit" &&
              (f.confirmDelete ? (
                <>
                  <Button
                    type="button"
                    onClick={f.onDelete}
                    disabled={f.busy}
                    className="mt-2.5 h-auto w-full rounded-[15px] bg-[#E5484D] py-[15px] text-[15px] font-bold text-white hover:bg-[#E5484D]/90"
                  >
                    {f.busy && <Spinner size="sm" />}
                    {t("confirmDelete")}
                  </Button>
                  <p className="mt-1.5 text-center text-[11px] font-medium text-text-3">
                    {t("deleteWarning", { count: portfolio?.transactionCount ?? 0 })}{" "}
                    {t("deleteRelatedNote")}
                  </p>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => f.setConfirmDelete(true)}
                  disabled={f.busy}
                  className="mt-2.5 w-full py-3 text-sm font-bold text-[#E5484D]"
                >
                  {t("delete")}
                </button>
              ))}
          </div>
        </form>

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
      </SheetContent>
    </Sheet>
  );
}

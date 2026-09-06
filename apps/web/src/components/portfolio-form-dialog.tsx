"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  const formId = useId();
  const f = usePortfolioForm(mode, portfolio, onSuccess);
  const title = mode === "edit" ? t("editTitle") : t("createTitle");

  // form={formId} (not nesting the button inside <form>) so it can live in the footer
  // slot below — same idiom add-transaction-form.tsx already uses for the same reason.
  const primaryButton =
    mode === "create" && f.createdPortfolio ? (
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
        form={formId}
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
    );

  return (
    <Dialog open={f.open} onOpenChange={f.onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* Overlay chrome migration (#625): centered md-size card at md:+, full-screen page
          below it — was an unconditional bottom Sheet regardless of viewport, one of
          four different chrome treatments this same form got across its entry points
          (holdings page, +-menu, portfolio card menu). onInteractOutside preserves the
          Sheet's old `dismissible={false}` — an in-progress create/edit shouldn't close
          on a stray backdrop tap; Escape still works. footer keeps the primary button
          persistently visible while scrolling a long form (regression test for #472) —
          only the primary action, not the rarer delete-confirm flow below it. */}
      <DialogContent
        size="md"
        mobileHeader={{ title }}
        footer={primaryButton}
        aria-describedby={subtitleId}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="p-4 md:p-6">
          {/* Mobile gets the title via mobileHeader's back-chevron row above; this is the
              one accessible DialogTitle (see dialog.tsx's note on why there isn't a
              second one), shown visibly only at md:+. */}
          <DialogTitle className="hidden text-lg font-semibold md:mb-1 md:block">
            {title}
          </DialogTitle>
          <p id={subtitleId} className="mb-4 text-xs font-medium text-text-2">
            {t("subtitle")}
          </p>

          <form id={formId} onSubmit={f.submit} className="space-y-4">
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
              allowNegativeCash={f.allowNegativeCash}
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
              onAllowNegativeCashChange={f.setAllowNegativeCash}
              onDocumentRetentionChange={f.setDocumentRetention}
              onIncludeInAggregateChange={f.setIncludeInAggregate}
            />

            {/* Delete is a rare, deliberate action — unlike the primary button above, it
                stays in-flow rather than pinned to the footer. */}
            {mode === "edit" && (
              <div className="pt-1">
                {f.confirmDelete ? (
                  <>
                    <Button
                      type="button"
                      onClick={f.onDelete}
                      disabled={f.busy}
                      className="h-auto w-full rounded-[15px] bg-[#E5484D] py-[15px] text-[15px] font-bold text-white hover:bg-[#E5484D]/90"
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
                    className="w-full py-3 text-sm font-bold text-[#E5484D]"
                  >
                    {t("delete")}
                  </button>
                )}
              </div>
            )}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

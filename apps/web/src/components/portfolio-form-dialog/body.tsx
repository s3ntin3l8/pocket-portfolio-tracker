"use client";

import { ErrorBanner } from "@/components/ui/error-banner";
import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useSheetFooter } from "@/components/ui/sheet";
import type { EditablePortfolio } from "./constants";
import { PortfolioFormSections } from "./sections/form-sections";
import { TrConnectionSection, IbkrConnectionSection } from "./sections/connection-section";
import { usePortfolioForm } from "./hooks";

/**
 * The `PortfolioFormDialog` body — a shared inline form used today by the desktop Add
 * Transaction shell's "Create portfolio" rail destination, and will also be used by the
 * mobile chooser's "Add portfolio" step once #669 lands and that stops nesting a
 * separate `PortfolioFormDialog`. The footer button's `max-md:`/`md:` classes below are
 * inert until then (this form is desktop-only-reachable today, at the 860px
 * `add-transaction-menu.tsx` breakpoint) — added now so #669's diff doesn't also need
 * to touch this file: full-width on mobile (matching the rest of the app's mobile
 * primary actions), compact on desktop (matching the rail shell's Cancel button beside
 * it).
 */
export function PortfolioFormBody({
  mode,
  portfolio,
  onSuccess,
  onDone,
}: {
  mode: "create" | "edit";
  portfolio?: EditablePortfolio;
  onSuccess?: () => void;
  onDone?: () => void;
}) {
  const t = useTranslations("PortfolioForm");
  const subtitleId = useId();
  const formId = useId();
  const f = usePortfolioForm(mode, portfolio, onSuccess);
  const footerEl = useSheetFooter();

  useEffect(() => {
    f.onOpenChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const footerButton =
    mode === "create" && f.createdPortfolio ? (
      <Button
        type="button"
        onClick={() => onDone?.()}
        className="h-auto max-md:w-full max-md:rounded-lg max-md:py-[15px] md:rounded-md md:px-[26px] md:py-[13px] text-sm font-bold"
      >
        {t("done")}
      </Button>
    ) : (
      <Button
        type="submit"
        form={formId}
        disabled={f.busy || !f.name.trim()}
        className="h-auto max-md:w-full max-md:rounded-lg max-md:py-[15px] md:rounded-md md:px-[26px] md:py-[13px] text-sm font-bold"
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
    <>
      {(f.showTrSection || f.showIbkrSection) && (
        <div className="mb-[13px] space-y-3">
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

      <form
        id={formId}
        onSubmit={f.submit}
        aria-describedby={subtitleId}
        className="flex max-w-[600px] flex-col gap-[13px]"
      >
        <p id={subtitleId} className="text-xs font-medium text-text-2">
          {t("subtitle")}
        </p>

        {f.error && <ErrorBanner>{t("error")}</ErrorBanner>}

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
          country={f.country}
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
          onCountryChange={f.setCountry}
          onTaxAllowanceChange={f.setTaxAllowanceAnnual}
          onCashCountedChange={f.setCashCounted}
          onAllowNegativeCashChange={f.setAllowNegativeCash}
          onDocumentRetentionChange={f.setDocumentRetention}
        />
      </form>

      {footerEl && createPortal(footerButton, footerEl)}
    </>
  );
}

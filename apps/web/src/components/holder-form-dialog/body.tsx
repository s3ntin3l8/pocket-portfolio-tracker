"use client";

import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import type { AccountHolder } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HolderTypeChips } from "@/components/holder-type-chips";
import { useSheetFooter } from "@/components/ui/sheet";
import { useHolderForm } from "./hooks";

/**
 * The `HolderFormDialog` body — used inline by `add-transaction-menu.tsx`'s "holder"
 * step (the desktop rail's "Account holder" destination and, since #669, the mobile
 * chooser's "Add account holder" card too — both render this same component, no nested
 * `Dialog`). Submit/validation logic (`useHolderForm`) is untouched; this only changes
 * what wraps it. Always creates (`mode: "create"`) at both reachable call sites today.
 *
 * Simulates the Sheet's "open" lifecycle once on mount (see `PortfolioFormBody` for why)
 * so the form's fields reset from `holder` the same way the Sheet trigger would.
 *
 * Field ids are `useId()`-derived, not hardcoded `-desktop`-suffixed strings — needed
 * now that this component mounts from more than one call site.
 */
export function HolderFormBody({
  mode,
  holder,
  onSuccess,
}: {
  mode: "create" | "edit";
  holder?: AccountHolder;
  onSuccess?: () => void;
}) {
  const t = useTranslations("AccountHolders");
  const tf = useTranslations("PortfolioForm");
  const formId = useId();
  const nameId = useId();
  const typeLabelId = useId();
  const birthYearId = useId();
  const taxResidenceId = useId();
  const taxAllowanceId = useId();
  const taxRateId = useId();
  const f = useHolderForm(mode, holder, onSuccess);
  const footerEl = useSheetFooter();

  useEffect(() => {
    f.onOpenChange(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const footerButton = (
    <Button
      type="submit"
      form={formId}
      disabled={f.busy || !f.name.trim()}
      className="h-auto max-md:w-full max-md:rounded-[15px] max-md:py-[15px] md:rounded-[13px] md:px-[26px] md:py-[13px] text-[14px] font-bold"
    >
      {f.busy && <Spinner size="sm" />}
      {mode === "edit" ? tf("save") : t("add")}
    </Button>
  );

  return (
    <>
      <form id={formId} onSubmit={f.submit} className="flex max-w-[600px] flex-col gap-[13px]">
        {f.error && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {t("error")}
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={nameId}>{tf("holderName")}</Label>
          <Input
            id={nameId}
            value={f.name}
            onChange={(e) => f.setName(e.target.value)}
            placeholder={tf("accountHolderPlaceholder")}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label id={typeLabelId}>{tf("holderType")}</Label>
          <HolderTypeChips value={f.type} onChange={f.setType} labelledBy={typeLabelId} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={birthYearId}>{tf("birthYear")}</Label>
          <Input
            id={birthYearId}
            type="number"
            inputMode="numeric"
            placeholder={tf("birthYearPlaceholder")}
            value={f.birthYear}
            onChange={(e) => f.setBirthYear(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{tf("birthYearHint")}</p>
        </div>

        {/* German tax profile (DE only, optional) */}
        <details className="rounded-md border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-muted-foreground select-none">
            {t("taxProfileSection")}
          </summary>
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={taxResidenceId}>{t("taxResidence")}</Label>
              <Input
                id={taxResidenceId}
                maxLength={2}
                placeholder="DE"
                value={f.taxResidence}
                onChange={(e) => f.setTaxResidence(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={taxAllowanceId}>{t("taxAllowance")}</Label>
              <Input
                id={taxAllowanceId}
                type="number"
                inputMode="decimal"
                placeholder="1000"
                value={f.taxAllowance}
                onChange={(e) => f.setTaxAllowance(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("taxAllowanceHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={taxRateId}>{t("capitalGainsTaxRate")}</Label>
              <Input
                id={taxRateId}
                type="number"
                inputMode="decimal"
                placeholder="0.25"
                min="0"
                max="1"
                step="0.00001"
                value={f.taxRate}
                onChange={(e) => f.setTaxRate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("capitalGainsTaxRateHint")}</p>
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={f.churchTax}
                onChange={(e) => f.setChurchTax(e.target.checked)}
                className="size-4"
              />
              {t("churchTax")}
            </label>
          </div>
        </details>
      </form>

      {footerEl && createPortal(footerButton, footerEl)}
    </>
  );
}

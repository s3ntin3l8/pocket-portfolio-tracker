"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import type { AccountHolder } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HolderTypeChips } from "@/components/holder-type-chips";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useHolderForm } from "./holder-form-dialog/hooks";

/** Create or edit a single holder. Delete lives in the row's ⋯ menu (a confirm modal). */
export function HolderFormDialog({
  mode,
  holder,
  trigger,
  onSuccess,
}: {
  mode: "create" | "edit";
  holder?: AccountHolder;
  trigger: React.ReactNode;
  onSuccess?: () => void;
}) {
  const t = useTranslations("AccountHolders");
  const tf = useTranslations("PortfolioForm");
  const subtitleId = useId();
  const formId = useId();
  const uid = useId();
  const f = useHolderForm(mode, holder, onSuccess);
  const title = mode === "edit" ? t("editTitle") : t("createTitle");

  const primaryButton = (
    <Button
      type="submit"
      form={formId}
      disabled={f.busy || !f.name.trim()}
      className="h-auto w-full rounded-[15px] py-[15px] text-[15px] font-bold"
    >
      {f.busy && <Spinner size="sm" />}
      {mode === "edit" ? tf("save") : t("add")}
    </Button>
  );

  return (
    <Dialog open={f.open} onOpenChange={f.onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      {/* Overlay chrome migration (#625): centered md-size card at md:+, full-screen page
          below it — was an unconditional bottom Sheet. Unlike PortfolioFormDialog, the
          original Sheet had no `dismissible={false}` (only `handleOnly`, which just
          restricted drag-to-close), so this one keeps the default outside-click-closes
          behavior — no onInteractOutside override. */}
      <DialogContent
        size="md"
        mobileHeader={{ title }}
        footer={primaryButton}
        aria-describedby={subtitleId}
      >
        <div className="p-4 md:p-6">
          <DialogTitle className="hidden text-lg font-semibold md:mb-1 md:block">
            {title}
          </DialogTitle>
          <p id={subtitleId} className="mb-4 text-xs font-medium text-text-2">
            {t("subtitle")}
          </p>

          <form id={formId} onSubmit={f.submit} className="space-y-4">
            {f.error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {t("error")}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-name`}>{tf("holderName")}</Label>
              <Input
                id={`${uid}-name`}
                value={f.name}
                onChange={(e) => f.setName(e.target.value)}
                placeholder={tf("accountHolderPlaceholder")}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label id={`${uid}-type-label`}>{tf("holderType")}</Label>
              <HolderTypeChips
                value={f.type}
                onChange={f.setType}
                labelledBy={`${uid}-type-label`}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-birth-year`}>{tf("birthYear")}</Label>
              <Input
                id={`${uid}-birth-year`}
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
                  <Label htmlFor={`${uid}-tax-residence`}>{t("taxResidence")}</Label>
                  <Input
                    id={`${uid}-tax-residence`}
                    maxLength={2}
                    placeholder="DE"
                    value={f.taxResidence}
                    onChange={(e) => f.setTaxResidence(e.target.value.toUpperCase())}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${uid}-tax-allowance`}>{t("taxAllowance")}</Label>
                  <Input
                    id={`${uid}-tax-allowance`}
                    type="number"
                    inputMode="decimal"
                    placeholder="1000"
                    value={f.taxAllowance}
                    onChange={(e) => f.setTaxAllowance(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{t("taxAllowanceHint")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`${uid}-tax-rate`}>{t("capitalGainsTaxRate")}</Label>
                  <Input
                    id={`${uid}-tax-rate`}
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
                <label className="flex cursor-pointer items-center gap-2 text-sm">
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

            {/* Delete is a rare, deliberate action — unlike the primary button (in the
                footer), it stays in-flow, mirroring the portfolio edit dialog. */}
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
                      {t("deleteWarning")}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

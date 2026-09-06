"use client";

import { useId } from "react";
import type { AccountHolder, AccountHolderType } from "@portfolio/api-client";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Eyebrow } from "@/components/ui/eyebrow";
import { BrokerageIcon } from "@/components/brokerage-icon";
import { HolderTypeChips } from "@/components/holder-type-chips";
import { KNOWN_BROKERAGES } from "@/lib/brokerages";
import { CURRENCIES, NEW_HOLDER } from "../constants";
import { AccountingSection } from "./accounting-section";

// space-y-3.5 gives the Eyebrow room from its first field — dropping it left the section
// label flush against the field below in all three form hosts (#625 review finding).
const CARD = "space-y-3.5 rounded-[16px] border border-border bg-card p-4 shadow-card";

export function PortfolioFormSections({
  // Basics
  name,
  brokerage,
  accountHolderId,
  holders,
  newHolderName,
  newHolderType,
  newHolderBirthYear,
  isTr,
  showTrChildNote,
  effectivePortfolio,
  // Account details
  accountNumber,
  iban,
  currency,
  taxAllowanceAnnual,
  showFsaHelper,
  fsaOverAllocated,
  totalAllocated,
  holderAllowanceCap,
  fsaRemainingForHolder,
  selectedHolderName,
  // Accounting
  cashCounted,
  allowNegativeCash,
  documentRetention,
  includeInAggregate,
  // Setters
  onNameChange,
  onBrokerageChange,
  onAccountHolderChange,
  onNewHolderNameChange,
  onNewHolderTypeChange,
  onNewHolderBirthYearChange,
  onAccountNumberChange,
  onIbanChange,
  onCurrencyChange,
  onTaxAllowanceChange,
  onCashCountedChange,
  onAllowNegativeCashChange,
  onDocumentRetentionChange,
  onIncludeInAggregateChange,
}: {
  name: string;
  brokerage: string;
  accountHolderId: string;
  holders: AccountHolder[];
  newHolderName: string;
  newHolderType: AccountHolderType;
  newHolderBirthYear: string;
  isTr: boolean;
  showTrChildNote: boolean;
  effectivePortfolio: { id: string } | null | undefined;
  accountNumber: string;
  iban: string;
  currency: string;
  taxAllowanceAnnual: string;
  showFsaHelper: boolean;
  fsaOverAllocated: boolean;
  totalAllocated: number;
  holderAllowanceCap: number;
  fsaRemainingForHolder: number;
  selectedHolderName: string | null;
  cashCounted: boolean;
  allowNegativeCash: boolean;
  documentRetention: boolean;
  includeInAggregate: boolean;
  onNameChange: (v: string) => void;
  onBrokerageChange: (v: string) => void;
  onAccountHolderChange: (v: string) => void;
  onNewHolderNameChange: (v: string) => void;
  onNewHolderTypeChange: (v: AccountHolderType) => void;
  onNewHolderBirthYearChange: (v: string) => void;
  onAccountNumberChange: (v: string) => void;
  onIbanChange: (v: string) => void;
  onCurrencyChange: (v: string) => void;
  onTaxAllowanceChange: (v: string) => void;
  onCashCountedChange: (v: boolean) => void;
  onAllowNegativeCashChange: (v: boolean) => void;
  onDocumentRetentionChange: (v: boolean) => void;
  onIncludeInAggregateChange: (v: boolean) => void;
}) {
  const t = useTranslations("PortfolioForm");
  // Distinct per mount — see the matching note in accounting-section.tsx.
  const uid = useId();

  return (
    <div className="space-y-3.5">
      {/* ── BASICS ── */}
      <div className={CARD}>
        <Eyebrow>{t("sectionBasics")}</Eyebrow>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-brokerage`}>{t("brokerage")}</Label>
            <div className="flex items-center gap-2">
              <BrokerageIcon brokerage={brokerage} />
              <Input
                id={`${uid}-brokerage`}
                value={brokerage}
                onChange={(e) => onBrokerageChange(e.target.value)}
                placeholder={t("brokeragePlaceholder")}
                list={`${uid}-brokerage-list`}
                autoComplete="off"
              />
            </div>
            <datalist id={`${uid}-brokerage-list`}>
              {KNOWN_BROKERAGES.map((b: string) => (
                <option key={b} value={b} />
              ))}
            </datalist>
            {isTr && !effectivePortfolio && !showTrChildNote && (
              <p className="text-xs text-muted-foreground">{t("trConnectAfterSave")}</p>
            )}
            {showTrChildNote && (
              <p className="text-xs text-muted-foreground">{t("trChildUnsupported")}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-name`}>{t("name")}</Label>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={t("namePlaceholder")}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-account-holder`}>{t("accountHolder")}</Label>
            <Select
              id={`${uid}-account-holder`}
              value={accountHolderId}
              onChange={(e) => onAccountHolderChange(e.target.value)}
            >
              <option value="">{t("holderNone")}</option>
              {holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                  {h.type === "child" ? ` · ${t("holderTypeChild")}` : ""}
                  {h.birthYear != null ? ` (${h.birthYear})` : ""}
                </option>
              ))}
              <option value={NEW_HOLDER}>{t("holderNew")}</option>
            </Select>
            <p className="text-xs text-muted-foreground">{t("accountHolderHint")}</p>

            {accountHolderId === NEW_HOLDER && (
              <div className="mt-2 space-y-3 rounded-md border border-border/60 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`${uid}-new-holder-name`}>{t("holderName")}</Label>
                  <Input
                    id={`${uid}-new-holder-name`}
                    value={newHolderName}
                    onChange={(e) => onNewHolderNameChange(e.target.value)}
                    placeholder={t("accountHolderPlaceholder")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label id={`${uid}-new-holder-type-label`}>{t("holderType")}</Label>
                  <HolderTypeChips
                    value={newHolderType}
                    onChange={onNewHolderTypeChange}
                    labelledBy={`${uid}-new-holder-type-label`}
                  />
                </div>
                {newHolderType === "child" && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`${uid}-new-holder-birth-year`}>{t("birthYear")}</Label>
                    <Input
                      id={`${uid}-new-holder-birth-year`}
                      type="number"
                      inputMode="numeric"
                      placeholder={t("birthYearPlaceholder")}
                      value={newHolderBirthYear}
                      onChange={(e) => onNewHolderBirthYearChange(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">{t("birthYearHint")}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── ACCOUNT DETAILS ── */}
      <div className={CARD}>
        <Eyebrow>{t("sectionAccount")}</Eyebrow>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-account-number`}>{t("accountNumber")}</Label>
            <Input
              id={`${uid}-account-number`}
              value={accountNumber}
              onChange={(e) => onAccountNumberChange(e.target.value)}
              placeholder={t("accountNumberPlaceholder")}
            />
          </div>

          <div className="flex items-start gap-3">
            <div className="w-[130px] shrink-0 space-y-1.5">
              <Label htmlFor={`${uid}-currency`}>{t("currency")}</Label>
              <Select
                id={`${uid}-currency`}
                value={currency}
                onChange={(e) => onCurrencyChange(e.target.value)}
              >
                {CURRENCIES.map((c: string) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>

            <div className="flex-1 space-y-1.5">
              <Label htmlFor={`${uid}-iban`}>{t("iban")}</Label>
              <Input
                id={`${uid}-iban`}
                value={iban}
                onChange={(e) => onIbanChange(e.target.value)}
                placeholder={t("ibanPlaceholder")}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-fsa`}>{t("taxAllowanceAnnual")}</Label>
            <Input
              id={`${uid}-fsa`}
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={taxAllowanceAnnual}
              onChange={(e) => onTaxAllowanceChange(e.target.value)}
              placeholder={t("taxAllowanceAnnualPlaceholder")}
            />
            {showFsaHelper && !fsaOverAllocated && (
              <p className="text-xs text-muted-foreground">
                {t("taxAllowanceHelper", {
                  allocated: totalAllocated.toFixed(0),
                  cap: holderAllowanceCap.toFixed(0),
                  remaining: fsaRemainingForHolder.toFixed(0),
                  holder: selectedHolderName ?? "",
                })}
              </p>
            )}
            {showFsaHelper && fsaOverAllocated && (
              <div className="flex items-start gap-1.5 text-xs text-yellow-700 dark:text-yellow-300">
                <TriangleAlert className="size-3.5 mt-0.5 shrink-0" />
                <span>
                  {t("taxAllowanceOverAllocated", { cap: holderAllowanceCap.toFixed(0) })}
                </span>
              </div>
            )}
            {!showFsaHelper && (
              <p className="text-xs text-muted-foreground">{t("taxAllowanceAnnualHint")}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── ACCOUNTING OPTIONS ── */}
      <div className={CARD}>
        <Eyebrow>{t("sectionAccounting")}</Eyebrow>
        <AccountingSection
          cashCounted={cashCounted}
          allowNegativeCash={allowNegativeCash}
          documentRetention={documentRetention}
          includeInAggregate={includeInAggregate}
          onCashCountedChange={onCashCountedChange}
          onAllowNegativeCashChange={onAllowNegativeCashChange}
          onDocumentRetentionChange={onDocumentRetentionChange}
          onIncludeInAggregateChange={onIncludeInAggregateChange}
        />
      </div>
    </div>
  );
}

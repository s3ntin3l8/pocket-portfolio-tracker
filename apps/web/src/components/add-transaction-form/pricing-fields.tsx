"use client";

import { ChevronRight } from "lucide-react";
import { useLocale } from "next-intl";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { NumberField } from "./number-field";
import { computeTxTotal, formatMoney, totalLabelKey } from "./totals";
import { cn } from "@/lib/utils";

const CURRENCIES = ["IDR", "USD", "EUR", "SGD"];

interface PricingFieldsProps {
  type: string;
  isGold: boolean;
  showQuantity: boolean;
  showInlineTax: boolean;
  showExtrasFields: boolean;
  showExtrasBtn: boolean;
  extrasLabelKey: string;
  feesLabelKey: string;
  onOpenExtras: () => void;
  showFees: boolean;
  showTax: boolean;
  priceLabelKey: string;
  priceHintKey: string | null;
  priceRequired: boolean;
  quantity: string;
  setQuantity: (v: string) => void;
  price: string;
  setPrice: (v: string) => void;
  fees: string;
  setFees: (v: string) => void;
  tax: string;
  setTax: (v: string) => void;
  currency: string;
  t: (key: string) => string;
  /** Suppresses the inline total card — the desktop Summary rail (`summary-rail.tsx`)
   *  shows the same figure instead. Defaults to showing it (mobile). */
  isDesktop?: boolean;
}

/** The v2 design's "Amount" section — quantity/price (+ inline tax for income), with an
 *  acquisition's fees/tax collapsed behind an "Add fees / tax" disclosure and, on mobile,
 *  a live running total. Currency/date/notes/tags live in the sibling `DetailsFields`. */
export function PricingFields({
  type,
  isGold,
  showQuantity,
  showInlineTax,
  showExtrasFields,
  showExtrasBtn,
  extrasLabelKey,
  feesLabelKey,
  onOpenExtras,
  showFees,
  showTax,
  priceLabelKey,
  priceHintKey,
  priceRequired,
  quantity,
  setQuantity,
  price,
  setPrice,
  fees,
  setFees,
  tax,
  setTax,
  currency,
  t,
  isDesktop = false,
}: PricingFieldsProps) {
  const total = computeTxTotal(type, quantity, price, fees, tax);
  // The app's locale, so the running total speaks the same spelling as the amounts above
  // it (and the Summary rail's desktop twin).
  const locale = useLocale();

  return (
    <div className="border-t border-line pt-[18px]">
      <p className="mb-2.5 text-micro font-bold uppercase tracking-label text-text-2">
        {t("amount")}
      </p>
      <div className="grid grid-cols-2 gap-3">
        {showQuantity && (
          <FormField label={isGold ? t("grams") : t("quantity")} id="tx-qty">
            <NumberField
              id="tx-qty"
              value={quantity}
              onValueChange={setQuantity}
              required
              min="0.000001"
            />
          </FormField>
        )}
        <FormField label={t(priceLabelKey)} id="tx-price">
          <NumberField
            id="tx-price"
            value={price}
            onValueChange={setPrice}
            required={priceRequired}
            placeholder={
              priceLabelKey === "transferBasis" ? t("transferBasisPlaceholder") : undefined
            }
          />
          {priceHintKey && <p className="mt-1 text-xs text-muted-foreground">{t(priceHintKey)}</p>}
        </FormField>
        {showInlineTax && (
          <FormField label={t("tax")} id="tx-tax">
            <NumberField id="tx-tax" value={tax} onValueChange={setTax} placeholder="0" />
          </FormField>
        )}
      </div>

      {/* The disclosure stays mounted while the panel is open, so its open/closed state is
          perceivable (the chevron rotates) — and the panel keeps its node (and its id)
          either way, so `aria-controls` always points at an element that exists. */}
      {(showExtrasBtn || showExtrasFields) && (
        <button
          type="button"
          onClick={onOpenExtras}
          aria-expanded={showExtrasFields}
          aria-controls="tx-extras-panel"
          className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-primary"
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", showExtrasFields && "rotate-90")}
            strokeWidth={2.2}
          />
          {t(extrasLabelKey)}
        </button>
      )}

      <div id="tx-extras-panel">
        {showExtrasFields && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            {showFees && (
              <FormField label={t(feesLabelKey)} id="tx-fees">
                <NumberField id="tx-fees" value={fees} onValueChange={setFees} />
              </FormField>
            )}
            {showTax && (
              <FormField label={t("tax")} id="tx-tax-extra">
                <NumberField id="tx-tax-extra" value={tax} onValueChange={setTax} placeholder="0" />
              </FormField>
            )}
          </div>
        )}
      </div>

      {/* Live estimated-total line — suppressed on desktop, where the Summary rail
          (`summary-rail.tsx`) shows the same figure alongside the rest of the form. */}
      {total && !isDesktop && (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-card-2 px-4 py-3.5">
          <span className="text-body-sm font-semibold text-text-2">
            {t(totalLabelKey(total.kind))}
          </span>
          <span className="text-lg font-bold text-foreground">
            {formatMoney(total.total, currency, locale)}
          </span>
        </div>
      )}
    </div>
  );
}

interface DetailsFieldsProps {
  currency: string;
  setCurrency: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  tags: string;
  setTags: (v: string) => void;
  t: (key: string) => string;
}

/** The v2 design's "Details" section — currency, date, notes and tags grouped together
 *  (previously scattered: currency/date lived in the Amount grid, notes/tags were bare
 *  top-level fields). */
export function DetailsFields({
  currency,
  setCurrency,
  date,
  setDate,
  description,
  setDescription,
  tags,
  setTags,
  t,
}: DetailsFieldsProps) {
  return (
    <div className="border-t border-line pt-[18px]">
      <p className="mb-2.5 text-micro font-bold uppercase tracking-label text-text-2">
        {t("details")}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <FormField label={t("currency")} id="tx-currency">
          <Select id="tx-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label={t("date")} id="tx-date">
          <DatePicker
            id="tx-date"
            label={t("date")}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </FormField>
        <div className="col-span-2">
          <FormField label={t("notes")} id="tx-notes">
            <textarea
              id="tx-notes"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("notesPlaceholder")}
              rows={2}
              className="flex w-full resize-y rounded-md border border-border bg-card px-3.5 py-[13px] text-base font-medium transition-colors placeholder:text-text-2 focus-visible:outline-none focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
            />
          </FormField>
        </div>
        <div className="col-span-2">
          <FormField label={t("tags")} id="tx-tags">
            <Input
              id="tx-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={t("tagsPlaceholder")}
            />
          </FormField>
        </div>
      </div>
    </div>
  );
}

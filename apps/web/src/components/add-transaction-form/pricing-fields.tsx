"use client";

import { isTradeType, isShareReceiptType, isTransferType } from "@portfolio/core";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { Field } from "./field";

const INCOME_TYPES = ["dividend", "coupon"] as const;
const CURRENCIES = ["IDR", "USD", "EUR", "SGD"];

interface PricingFieldsProps {
  type: string;
  isGold: boolean;
  quantity: string;
  setQuantity: (v: string) => void;
  price: string;
  setPrice: (v: string) => void;
  fees: string;
  setFees: (v: string) => void;
  tax: string;
  setTax: (v: string) => void;
  shares: string;
  setShares: (v: string) => void;
  perShare: string;
  setPerShare: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
  t: (key: string) => string;
}

export function PricingFields({
  type,
  isGold,
  quantity,
  setQuantity,
  price,
  setPrice,
  fees,
  setFees,
  tax,
  setTax,
  shares,
  setShares,
  perShare,
  setPerShare,
  currency,
  setCurrency,
  date,
  setDate,
  t,
}: PricingFieldsProps) {
  const isAcquisition = isTradeType(type);
  const isShareReceipt = isShareReceiptType(type);
  const isTransfer = isTransferType(type);
  const isIncome = (INCOME_TYPES as readonly string[]).includes(type);
  const isAdjustment = type === "adjustment";

  const showQuantity = isAcquisition || isShareReceipt || isTransfer;
  const showFees = isAcquisition;
  const showTax = isAcquisition || isIncome;
  const priceRequired = !isShareReceipt && !isTransfer;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {showQuantity && (
        <Field label={isGold ? t("grams") : t("quantity")} htmlFor="tx-qty">
          <Input
            id="tx-qty"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            min="0.000001"
          />
        </Field>
      )}
      <Field
        label={
          isTransfer
            ? t("transferBasis")
            : isGold && showQuantity
              ? t("pricePerGram")
              : showQuantity
                ? t("price")
                : t("amount")
        }
        htmlFor="tx-price"
      >
        <Input
          id="tx-price"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required={priceRequired}
          placeholder={isTransfer ? t("transferBasisPlaceholder") : undefined}
        />
        {isTransfer && (
          <p className="mt-1 text-xs text-muted-foreground">{t("transferBasisHint")}</p>
        )}
        {isAdjustment && (
          <p className="mt-1 text-xs text-muted-foreground">{t("adjustmentHint")}</p>
        )}
      </Field>
      {showFees && (
        <Field label={t("fees")} htmlFor="tx-fees">
          <Input
            id="tx-fees"
            inputMode="decimal"
            value={fees}
            onChange={(e) => setFees(e.target.value)}
          />
        </Field>
      )}
      {showTax && (
        <Field label={t("tax")} htmlFor="tx-tax">
          <Input
            id="tx-tax"
            inputMode="decimal"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            placeholder="0"
          />
        </Field>
      )}
      {isIncome && (
        <Field label={t("shares")} htmlFor="tx-shares">
          <Input
            id="tx-shares"
            inputMode="decimal"
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            placeholder={t("sharesPlaceholder")}
          />
        </Field>
      )}
      {isIncome && (
        <Field label={t("perShare")} htmlFor="tx-per-share">
          <Input
            id="tx-per-share"
            inputMode="decimal"
            value={perShare}
            onChange={(e) => setPerShare(e.target.value)}
            placeholder={t("perSharePlaceholder")}
          />
        </Field>
      )}
      <Field label={t("currency")} htmlFor="tx-currency">
        <Select id="tx-currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("date")} htmlFor="tx-date">
        <DatePicker
          id="tx-date"
          label={t("date")}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </Field>
    </div>
  );
}

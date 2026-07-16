"use client";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Field } from "./field";

const INCOME_TYPES = ["dividend", "coupon"] as const;
const CURRENCIES = ["IDR", "USD", "EUR", "SGD"];

interface AdvancedFieldsProps {
  type: string;
  fxRate: string;
  setFxRate: (v: string) => void;
  kind: string;
  setKind: (v: string) => void;
  nativeCurrency: string;
  setNativeCurrency: (v: string) => void;
  grossNative: string;
  setGrossNative: (v: string) => void;
  t: (key: string) => string;
}

export function AdvancedFields({
  type,
  fxRate,
  setFxRate,
  kind,
  setKind,
  nativeCurrency,
  setNativeCurrency,
  grossNative,
  setGrossNative,
  t,
}: AdvancedFieldsProps) {
  const isIncome = (INCOME_TYPES as readonly string[]).includes(type);

  return (
    <details className="group">
      <summary className="cursor-pointer select-none text-sm text-muted-foreground hover:text-foreground">
        {t("advanced")}
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={t("fxRate")} htmlFor="tx-fx-rate">
          <Input
            id="tx-fx-rate"
            inputMode="decimal"
            value={fxRate}
            onChange={(e) => setFxRate(e.target.value)}
            placeholder={t("fxRatePlaceholder")}
          />
        </Field>
        <Field label={t("subType")} htmlFor="tx-sub-type">
          <Select id="tx-sub-type" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t("subTypeNone")}</option>
            <option value="saveback">{t("subTypeSaveback")}</option>
            <option value="roundup">{t("subTypeRoundup")}</option>
            <option value="merger">{t("subTypeMerger")}</option>
          </Select>
        </Field>
        {isIncome && (
          <Field label={t("nativeCurrency")} htmlFor="tx-native-currency">
            <Select
              id="tx-native-currency"
              value={nativeCurrency}
              onChange={(e) => setNativeCurrency(e.target.value)}
            >
              <option value="">{t("subTypeNone")}</option>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {isIncome && (
          <Field label={t("grossNative")} htmlFor="tx-gross-native">
            <Input
              id="tx-gross-native"
              inputMode="decimal"
              value={grossNative}
              onChange={(e) => setGrossNative(e.target.value)}
              placeholder={t("grossNativePlaceholder")}
            />
          </Field>
        )}
      </div>
    </details>
  );
}

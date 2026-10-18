"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { COUNTRY_CODES } from "@portfolio/schema";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Every ISO 3166-1 alpha-2 code with its name in `locale`, sorted by that name. A stored
 * code outside the list (written through the API before the list changed) stays selectable,
 * so saving the form never clears it silently.
 */
export function countryOptions(locale: string, current: string): { code: string; name: string }[] {
  // An unusable locale tag throws (RangeError); fall back to bare codes in default order.
  let names: Intl.DisplayNames | null = null;
  let sortLocale: string | undefined;
  try {
    names = new Intl.DisplayNames([locale], { type: "region" });
    sortLocale = locale;
  } catch {
    names = null;
  }
  const codes: string[] = [...COUNTRY_CODES];
  if (current && !codes.includes(current)) codes.push(current);
  return codes
    .map((code) => ({ code, name: names?.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, sortLocale));
}

/** The portfolio's country: where the account is held, or "" for not set. */
export function CountrySelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("PortfolioForm");
  const locale = useLocale();
  const options = useMemo(() => countryOptions(locale, value), [locale, value]);
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t("country")}</Label>
      <Select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hintId}
      >
        <option value="">{t("countryNone")}</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.name}
          </option>
        ))}
      </Select>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t("countryHint")}
      </p>
    </div>
  );
}

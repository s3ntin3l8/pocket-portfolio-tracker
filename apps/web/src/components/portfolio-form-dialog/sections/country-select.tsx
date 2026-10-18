"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { COUNTRY_CODES } from "@portfolio/schema";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Every ISO 3166-1 alpha-2 code with its name in `locale`, sorted by that name.
 *
 * `current` is defensive only: the API rejects any code outside `COUNTRY_CODES`, so no write
 * path produces one. A row written outside it (a manual DB edit, or a code later withdrawn
 * from the list) stays selectable, appended last, so saving the form doesn't clear it.
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
  const options = COUNTRY_CODES.map((code) => ({ code, name: names?.of(code) ?? code })).sort(
    (a, b) => a.name.localeCompare(b.name, sortLocale),
  );
  return withCurrent(options, current);
}

/** `options` plus `current` at the end when it is set and not already listed. */
function withCurrent(
  options: { code: string; name: string }[],
  current: string,
): { code: string; name: string }[] {
  if (!current || options.some((o) => o.code === current)) return options;
  return [...options, { code: current, name: current }];
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
  // Localize and sort once per locale; a selection only re-checks the out-of-list case.
  const localized = useMemo(() => countryOptions(locale, ""), [locale]);
  const options = withCurrent(localized, value);
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

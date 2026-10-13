"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";

/**
 * Collect the `fxMissingCurrencies` of several API payloads (any may be null/undefined),
 * deduplicated and sorted — for a page that renders several responses.
 */
export function collectFxMissing(
  ...sources: ({ fxMissingCurrencies?: string[] | null } | null | undefined | string[])[]
): string[] {
  const out = new Set<string>();
  for (const s of sources) {
    if (!s) continue;
    const list = Array.isArray(s) ? s : (s.fxMissingCurrencies ?? []);
    for (const c of list) out.add(c);
  }
  return [...out].sort();
}

/**
 * Non-blocking notice that some amounts on the page had no exchange rate and are left
 * out of its totals (audit B2: never converted 1:1, never a failed page). Renders
 * nothing when every rate resolved.
 */
export function FxMissingBanner({ currencies }: { currencies: string[] | null | undefined }) {
  const t = useTranslations("FxMissing");
  if (!currencies || currencies.length === 0) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold">{t("title")}</span>{" "}
        {t("body", { currencies: currencies.join(", "), count: currencies.length })}
      </span>
    </div>
  );
}

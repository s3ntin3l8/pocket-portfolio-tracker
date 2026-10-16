"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";

// `collectFxMissing` (the server-side aggregator) lives in `@/lib/fx-missing` — this file
// is a client module, and a function exported from here cannot be called by a server
// component (React: "Attempted to call collectFxMissing() from the server").

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
      className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warn-strong"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        <span className="font-semibold">{t("title")}</span>{" "}
        {t("body", { currencies: currencies.join(", "), count: currencies.length })}
      </span>
    </div>
  );
}

import { Link } from "@/i18n/navigation";
import type { TaxTranslator } from "./tax-cards";

/**
 * Quiet, read-only "Regime: Germany · Change" line for the Tax page header. The tax
 * regime is a GLOBAL preference (`userPreferences.taxRegime`), so this page never
 * writes it — "Change" just links to Settings › Investing, the single place to switch.
 */
export function RegimeIndicator({ regime, t }: { regime: "DE" | "ID"; t: TaxTranslator }) {
  return (
    <span data-testid="tax-regime-indicator">
      {t("regime.indicator", { regime: regime === "ID" ? t("regime.id") : t("regime.de") })}
      {" · "}
      <Link
        href="/settings/investing"
        className="font-semibold text-foreground underline-offset-2 hover:underline"
      >
        {t("regime.change")}
      </Link>
    </span>
  );
}

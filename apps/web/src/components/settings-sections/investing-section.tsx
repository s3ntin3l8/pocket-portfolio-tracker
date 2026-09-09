import { getTranslations } from "next-intl/server";
import { PreferenceChips } from "@/components/preference-chips";
import { BenchmarkSettingsForm } from "@/components/settings-sections/benchmark-settings-form";
import { RetirementAgeForm } from "@/components/settings-sections/retirement-age-form";
import type { UserPreferences } from "@portfolio/api-client";

/**
 * The Settings "Investing" section — real chip controls backed by the global
 * `user_preferences.taxRegime`/`costBasisMode` columns. Tax regime and cost basis
 * are grouped into one block; retirement and benchmarks are separate.
 */
export async function InvestingSection({ prefs }: { prefs: UserPreferences | null }) {
  const t = await getTranslations("Settings");
  const taxRegime = prefs?.taxRegime ?? "DE";
  const costBasisMode = prefs?.costBasisMode ?? "purchase_price";

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 px-0.5 text-xs font-bold uppercase tracking-[.04em] text-text-3">
          {t("investingTaxLabel")}
        </p>
        <div className="divide-y divide-line overflow-hidden rounded-2xl bg-card shadow-card">
          <div className="p-4">
            <PreferenceChips
              variant="wide"
              prefKey="taxRegime"
              current={taxRegime}
              options={[
                { value: "DE", label: t("taxCodeGermany") },
                { value: "ID", label: t("taxCodeIndonesia") },
              ]}
            />
            <p className="mt-2.5 px-0.5 text-xs text-muted-foreground">
              {taxRegime === "ID" ? t("investingTaxNoteId") : t("investingTaxNoteDe")}
            </p>
          </div>
          <div className="p-4">
            <PreferenceChips
              variant="wide"
              prefKey="costBasisMode"
              current={costBasisMode}
              options={[
                { value: "purchase_price", label: t("costBasisPurchasePrice") },
                { value: "total_paid", label: t("costBasisTotalPaid") },
              ]}
            />
            <p className="mt-2.5 px-0.5 text-xs text-muted-foreground">
              {t("investingCostBasisNote")}
            </p>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 px-0.5 text-xs font-bold uppercase tracking-[.04em] text-text-3">
          {t("retirementLabel")}
        </p>
        <div className="overflow-hidden rounded-2xl bg-card shadow-card">
          <div className="p-4">
            <RetirementAgeForm age={prefs?.retirementAge ?? null} />
          </div>
        </div>
      </div>

      <div>
        <p className="mb-2 px-0.5 text-xs font-bold uppercase tracking-[.04em] text-text-3">
          {t("benchmarkLabel")}
        </p>
        <div className="overflow-hidden rounded-2xl bg-card shadow-card">
          <div className="p-4">
            <BenchmarkSettingsForm
              symbols={prefs?.benchmarkSymbols ?? []}
              rate={prefs?.riskFreeRate ?? null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

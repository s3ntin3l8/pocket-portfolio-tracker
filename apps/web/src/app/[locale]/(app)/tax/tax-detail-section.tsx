import { StatCard } from "@/components/stat-card";
import { EstimatedTaxHero, type TaxTranslator } from "@/components/tax/tax-cards";
import {
  DividendsTable,
  ByYearTable,
  IdIncomeTable,
  IdForeignIncomeTable,
  IdByYearTable,
} from "@/components/tax/tax-tables";
import { DisposalTable, IdSalesTable } from "@/components/tax/disposal-table";
import type { TaxYearDetail } from "@/lib/server-api";
import { formatMoneyCompact } from "@/lib/utils";

/** Per-holder DE detail tables (DisposalTable + DividendsTable + ByYearTable). */
export function TaxHolderDetailDE({
  detail,
  currency,
  locale,
  year,
}: {
  detail: TaxYearDetail | null;
  currency: string;
  locale: string;
  year: number;
}) {
  if (!detail) return null;
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <DisposalTable
          rows={detail.disposals}
          totalProceeds={detail.totalProceeds}
          totalGain={detail.totalGain}
          currency={currency}
          locale={locale}
          year={year}
        />
        <DividendsTable
          rows={detail.dividendRows}
          totalsByCurrency={detail.dividendTotalsByCurrency}
          locale={locale}
          year={year}
        />
      </div>
      <ByYearTable rows={detail.byYear} currency={currency} locale={locale} />
    </>
  );
}

export function TaxHolderSectionId({
  detail,
  money,
  currency,
  locale,
  year,
  t,
}: {
  detail: TaxYearDetail | null;
  money: (n: string | number) => string;
  currency: string;
  locale: string;
  year: number;
  t: TaxTranslator;
}) {
  const moneyCompact = (n: string | number) => formatMoneyCompact(Number(n), currency, locale);
  // Indonesian final-tax breakdown, computed server-side by /portfolios/:id/tax and
  // /networth/tax; consumed as-is (no client-side recompute), so the API stays the single
  // source of truth.
  const idTax = detail?.indonesianFinalTax;
  if (!idTax) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("id.unavailable", { defaultValue: "Indonesian tax breakdown is unavailable." })}
      </p>
    );
  }

  const domesticIncome = idTax.income.filter((r) => r.category !== "foreign");
  const foreignIncome = idTax.income.filter((r) => r.category === "foreign");

  return (
    <>
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <EstimatedTaxHero
          label={t("id.hero.estimatedTax", { year })}
          value={moneyCompact(idTax.estimatedTax)}
          description={t("id.hero.estimatedTaxDesc", {
            withheld: moneyCompact(idTax.taxWithheldAtSource),
            selfPay: moneyCompact(idTax.taxToSelfPay),
          })}
        />
        <StatCard
          label={t("id.hero.salesTax")}
          value={money(idTax.totalSalesTax)}
          delta={t("id.hero.salesTaxDesc", { amount: money(idTax.totalProceeds) })}
        />
        <StatCard
          label={t("id.hero.dividendTax")}
          value={money(idTax.totalIncomeTax)}
          delta={t("id.hero.dividendTaxDesc", { amount: money(idTax.totalIncomeGross) })}
        />
      </div>

      {/* Stacked: the income table's five columns don't fit a half-width card. */}
      <div className="grid gap-4">
        <IdSalesTable
          rows={idTax.disposals}
          totalProceeds={idTax.totalProceeds}
          totalSalesTax={idTax.totalSalesTax}
          currency={currency}
          locale={locale}
          year={year}
        />
        <IdIncomeTable
          rows={domesticIncome}
          totalIncomeGross={idTax.totalIncomeGross}
          totalIncomeTax={idTax.totalIncomeTax}
          totalIncomeNet={idTax.totalIncomeNet}
          currency={currency}
          locale={locale}
          year={year}
        />
      </div>

      <IdForeignIncomeTable
        rows={foreignIncome}
        foreignIncomeGross={idTax.foreignIncomeGross}
        foreignTaxWithheld={idTax.foreignTaxWithheld}
        currency={currency}
        locale={locale}
      />

      <IdByYearTable rows={idTax.byYear} currency={currency} locale={locale} />

      <p className="text-xs text-muted-foreground leading-relaxed">{t("id.footnote")}</p>
    </>
  );
}

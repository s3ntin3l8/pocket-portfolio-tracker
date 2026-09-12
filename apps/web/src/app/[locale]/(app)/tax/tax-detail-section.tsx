import { getTranslations, setRequestLocale } from "next-intl/server";
import { StatCard } from "@/components/stat-card";
import { EstimatedTaxHero, type TaxTranslator } from "@/components/tax/tax-cards";
import {
  DividendsTable,
  ByYearTable,
  IdDividendsTable,
  IdByYearTable,
} from "@/components/tax/tax-tables";
import { DisposalTable, IdSalesTable } from "@/components/tax/disposal-table";
import { loadPreferences, type TaxYearDetail } from "@/lib/server-api";
import { formatMoney, formatMoneyCompact } from "@/lib/utils";
import type { IndonesianFinalTax } from "@portfolio/core";

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
  // Indonesian final-tax breakdown is now computed server-side by /portfolios/:id/tax;
  // consuming detail.indonesianFinalTax directly (no client-side recompute) keeps the
  // API as the single source of truth. The cast bridges the api-client's structural
  // shape (lots typed loosely as unknown[]) to the @portfolio/core type the ID tables
  // accept.
  const idTax = detail?.indonesianFinalTax as unknown as
    (IndonesianFinalTax & { lots?: unknown }) | undefined;
  if (!idTax) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("id.unavailable", { defaultValue: "Indonesian tax breakdown is unavailable." })}
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <EstimatedTaxHero
          tone="green"
          label={t("id.hero.estimatedTax", { year })}
          value={moneyCompact(idTax.estimatedTax)}
          description={t("id.hero.estimatedTaxDesc")}
        />
        <StatCard
          label={t("id.hero.salesTax")}
          value={money(idTax.totalSalesTax)}
          delta={t("id.hero.salesTaxDesc", { amount: money(idTax.totalProceeds) })}
        />
        <StatCard
          label={t("id.hero.dividendTax")}
          value={money(idTax.totalDividendTax)}
          delta={t("id.hero.dividendTaxDesc", { amount: money(idTax.totalDividendGross) })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <IdSalesTable
          rows={idTax.disposals}
          totalProceeds={idTax.totalProceeds}
          totalSalesTax={idTax.totalSalesTax}
          currency={currency}
          locale={locale}
          year={year}
        />
        <IdDividendsTable
          rows={idTax.dividends}
          totalDividendGross={idTax.totalDividendGross}
          totalDividendTax={idTax.totalDividendTax}
          totalDividendNet={idTax.totalDividendNet}
          currency={currency}
          locale={locale}
          year={year}
        />
      </div>

      <IdByYearTable rows={idTax.byYear} currency={currency} locale={locale} />

      <p className="text-xs text-muted-foreground leading-relaxed">{t("id.footnote")}</p>
    </>
  );
}

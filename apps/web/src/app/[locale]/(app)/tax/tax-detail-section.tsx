import { getTranslations, setRequestLocale } from "next-intl/server";
import { StatCard } from "@/components/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { EstimatedTaxHero, type TaxTranslator } from "@/components/tax/tax-cards";
import {
  DividendsTable,
  ByYearTable,
  IdDividendsTable,
  IdByYearTable,
} from "@/components/tax/tax-tables";
import { DisposalTable, IdSalesTable } from "@/components/tax/disposal-table";
import { loadTaxYearDetail, loadPreferences, type TaxYearDetail } from "@/lib/server-api";
import { formatMoney, formatMoneyCompact } from "@/lib/utils";
import type { TaxSummaryHolder } from "@portfolio/api-client";
import type { IndonesianFinalTax } from "@portfolio/core";

export function TaxDetailSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-4">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-24 rounded-xl" />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
          <Skeleton className="h-48 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

export async function TaxDetailSection({
  holders,
  year,
  locale,
}: {
  holders: TaxSummaryHolder[];
  year?: number;
  locale: string;
}) {
  setRequestLocale(locale);
  const t = await getTranslations("Tax");
  const prefs = await loadPreferences();
  const regime = prefs?.taxRegime ?? "DE";
  const detailByHolder = await loadTaxYearDetail(holders, year);

  return (
    <>
      {holders.map((entry) => {
        const detail = detailByHolder.get(entry.holder.id) ?? null;
        const currency = regime === "ID" ? (detail?.currency ?? entry.currency) : entry.currency;
        const money = (n: string | number) => formatMoney(Number(n), currency, locale);

        if (regime === "ID") {
          return (
            <section key={entry.holder.id} className="space-y-4">
              <TaxHolderSectionId
                detail={detail}
                money={money}
                currency={currency}
                locale={locale}
                year={entry.year}
                t={t}
              />
            </section>
          );
        }

        return (
          <section key={entry.holder.id} className="space-y-4">
            {detail && (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <DisposalTable
                    rows={detail.disposals}
                    totalProceeds={detail.totalProceeds}
                    totalGain={detail.totalGain}
                    currency={currency}
                    locale={locale}
                    year={entry.year}
                  />
                  <DividendsTable
                    rows={detail.dividendRows}
                    totalsByCurrency={detail.dividendTotalsByCurrency}
                    locale={locale}
                    year={entry.year}
                  />
                </div>
                <ByYearTable rows={detail.byYear} currency={currency} locale={locale} />
              </>
            )}
          </section>
        );
      })}
    </>
  );
}

function TaxHolderSectionId({
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

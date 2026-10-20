import { DataState } from "@/components/data-state";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Wallet } from "lucide-react";
import { EditTransaction } from "@/components/edit-transaction";
import { PageHeader } from "@/components/page-header";
import { loadTransactionsAcrossPortfolios } from "@/lib/server-api";

export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ locale: string; txId: string }>;
}) {
  const { locale, txId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Manage");
  const te = await getTranslations("Empty");

  // Resolve across all portfolios so an aggregate-view row edits regardless of scope.
  const result = await loadTransactionsAcrossPortfolios(txId);

  const header = (title: string, subtitle: string) => (
    <PageHeader
      title={title}
      subtitle={subtitle}
      backHref="/transactions"
      backLabel={t("back")}
      className="mb-0"
    />
  );

  if (result.status !== "ok") {
    return (
      <div className="space-y-6">
        {header(t("tx.editTitle"), t("tx.subtitle"))}
        <DataState
          status={result.status}
          retryAfter={result.retryAfter ?? null}
          icon={Wallet}
          empty={{ title: te("noTransactionsTitle"), description: te("noTransactionsBody") }}
        />
      </div>
    );
  }

  const tx = result.transactions.find((x) => x.id === txId);
  if (!tx) notFound();

  return (
    <div className="space-y-6">
      {header(t("tx.editTitle"), t("tx.subtitle"))}
      <EditTransaction
        portfolioId={tx.portfolioId}
        txId={tx.id}
        initial={{
          type: tx.type,
          instrumentId: tx.instrumentId,
          instrument: tx.instrument,
          quantity: tx.quantity,
          price: tx.price,
          fees: tx.fees,
          tax: tx.tax,
          fxRate: tx.fxRate,
          perShare: tx.perShare,
          shares: tx.shares,
          nativeCurrency: tx.nativeCurrency,
          grossNative: tx.grossNative,
          description: tx.description,
          tags: tx.tags,
          currency: tx.currency,
          executedAt: tx.executedAt,
          sources: tx.sources,
          hasFullTaxDetail: tx.hasFullTaxDetail,
          kind: tx.kind,
          source: tx.source,
          externalId: tx.externalId,
          loanId: tx.loanId,
          installmentN: tx.installmentN,
          idReinvested: tx.idReinvested,
        }}
      />
    </div>
  );
}

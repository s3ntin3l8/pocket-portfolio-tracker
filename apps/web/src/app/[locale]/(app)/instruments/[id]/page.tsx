import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LineChart } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { DataState } from "@/components/data-state";
import { retryAfterOf } from "@/lib/data-status";
import { InstrumentFundamentalsCard } from "@/components/instrument-fundamentals-card";
import { InstrumentManualPriceCard } from "@/components/instrument-manual-price-card";
import { InstrumentVisitTracker } from "@/components/instrument-visit-tracker";
import { PageHeaderSetter } from "@/components/page-header";
import {
  instrumentOnce,
  meOnce,
  startInstrumentLoads,
  type InstrumentTxFilters,
} from "@/components/instrument/instrument-data";
import { InstrumentBackButton, InstrumentHeader } from "@/components/instrument/instrument-header";
import {
  InstrumentPriceSection,
  InstrumentLotsSection,
  InstrumentIncomeSection,
  InstrumentTransactionsSection,
  InstrumentCorporateActionsSection,
  InstrumentPositionSection,
} from "@/components/instrument/instrument-sections";
import {
  InstrumentCardSkeleton,
  InstrumentTransactionsSkeleton,
} from "@/components/instrument/instrument-skeletons";

const TIMING = typeof process !== "undefined" && process.env?.TIMING_ENABLED === "true";

export default async function InstrumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams?: Promise<{
    page?: string;
    type?: string;
    year?: string;
    q?: string;
    status?: string;
  }>;
}) {
  // eslint-disable-next-line react-hooks/purity
  const t0 = TIMING ? performance.now() : 0;
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Instrument");

  const sp = await searchParams;
  const filters: InstrumentTxFilters = {
    page: Math.max(1, Number(sp?.page ?? "1")),
    type: sp?.type ?? undefined,
    year: sp?.year ?? undefined,
    q: sp?.q ?? undefined,
    status: sp?.status === "draft" ? "draft" : undefined,
  };

  // Blocking path: only what decides WHICH page this is (not found / error / instrument).
  // Every loader the streamed sections need is started NOW (not awaited) so they overlap
  // with this gate instead of waterfalling after it; each section then awaits its own
  // request-`cache()`d loader (see components/instrument/instrument-data.ts).
  startInstrumentLoads(id, filters);
  const [instrumentResult, me] = await Promise.all([instrumentOnce(id), meOnce()]);

  if (TIMING) {
    // eslint-disable-next-line react-hooks/purity
    const durationMs = performance.now() - t0;
    console.log(
      JSON.stringify({
        level: "info",
        msg: `[timing] InstrumentPage data fetch`,
        durationMs: Math.round(durationMs * 100) / 100,
      }),
    );
  }

  if (instrumentResult.status === "not_found") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <InstrumentBackButton />
        </div>
        <EmptyState icon={LineChart} title={t("notFound")} description={t("notFoundBody")} />
      </div>
    );
  }

  // Transient failures (rate limit, expired session, API down) are never "not found".
  if (instrumentResult.status !== "ok") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <InstrumentBackButton />
        </div>
        <DataState status={instrumentResult.status} retryAfter={retryAfterOf(instrumentResult)} />
      </div>
    );
  }

  const { instrument } = instrumentResult.data;
  const isAdmin = Boolean(me?.isAdmin);

  // Prefer the provider-enriched presentation name (`Apple Inc.`) over the raw
  // broker/import `name` (which can be a description or just the ticker). Some providers
  // set `displayName = symbol`, so fall back to `name` when they match. The hero + the
  // desktop topbar both render this string, so it must be the user-facing form.
  const heroName =
    instrument.displayName && instrument.displayName !== instrument.symbol
      ? instrument.displayName
      : instrument.name;

  return (
    <div className="space-y-6">
      <PageHeaderSetter title={heroName} backHref="/holdings" />
      <InstrumentVisitTracker id={id} symbol={instrument.symbol} />
      <InstrumentHeader instrument={instrument} heroName={heroName} isAdmin={isAdmin} />

      <div className="grid grid-cols-1 gap-6 @xl:grid-cols-[minmax(0,1fr)_300px] @xl:items-start">
        {/* ── Main column: price chart + fundamentals + lots + transactions ──
            `min-w-0` is the standard grid-item reset: without it, a child sized to its
            intrinsic content (chart, wide table) can blow past the 1fr track and produce
            a horizontal scrollbar on the page — which is what the old layout was doing
            once the fundamentals card or the DesktopTable had more columns than fit. */}
        <div className="space-y-6 min-w-0">
          <Suspense fallback={<InstrumentCardSkeleton height="h-64" />}>
            <InstrumentPriceSection id={id} />
          </Suspense>

          {/* Fundamentals: PE, market cap, dividend yield, analyst recs, revenue-vs-earnings —
              client-fetched (self-heals a per-instrument DB cache), so a slow/unreachable
              provider can't block the rest of the page. Only meaningful for equity/ETF; other
              asset classes (gold, bond, mutual_fund, crypto, cash) never had a fundamentals
              concept, so the card isn't even mounted for them. */}
          {(instrument.assetClass === "equity" || instrument.assetClass === "etf") && (
            <InstrumentFundamentalsCard instrumentId={id} />
          )}

          <div className="grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] gap-4">
            <Suspense fallback={<InstrumentCardSkeleton />}>
              <InstrumentLotsSection id={id} />
            </Suspense>
            <Suspense fallback={<InstrumentCardSkeleton />}>
              <InstrumentIncomeSection id={id} locale={locale} />
            </Suspense>
            {instrument.assetClass === "bond" && (
              <InstrumentManualPriceCard instrument={instrument} />
            )}
          </div>

          <Suspense fallback={<InstrumentTransactionsSkeleton />}>
            <InstrumentTransactionsSection id={id} filters={filters} />
          </Suspense>

          <Suspense fallback={<InstrumentCardSkeleton />}>
            <InstrumentCorporateActionsSection id={id} />
          </Suspense>
        </div>

        {/* ── Sidebar: position stats (sticky on wide containers) ── */}
        <div className="space-y-6 @xl:sticky @xl:top-[calc(70px+env(safe-area-inset-top))] @xl:max-h-[calc(100dvh-90px)] @xl:overflow-y-auto @xl:order-last">
          <Suspense fallback={<InstrumentCardSkeleton />}>
            <InstrumentPositionSection id={id} locale={locale} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

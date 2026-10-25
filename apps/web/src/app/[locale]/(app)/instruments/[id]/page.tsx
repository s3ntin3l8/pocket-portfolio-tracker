import { Suspense } from "react";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LineChart } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { DataState } from "@/components/data-state";
import { BackLink } from "@/components/back-button";
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
import { InstrumentHeader } from "@/components/instrument/instrument-header";
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
import { PageRail, PageWithRail } from "@/components/page-with-rail";
import { routing } from "@/i18n/routing";

const TIMING = typeof process !== "undefined" && process.env?.TIMING_ENABLED === "true";

/**
 * The app routes an instrument can be opened from (the holdings, income, transactions and
 * trades tables, plus wherever the global search was opened). The `Referer` header is
 * user-controlled, so only these known routes are accepted as a back target — the target
 * is rebuilt from the matched route, never taken verbatim from the header, so the link
 * can never leave the app.
 */
const BACK_TARGET_ROUTES = [
  "/holdings",
  "/dashboard",
  "/transactions",
  "/trades",
  "/income",
  "/reports",
  "/insights",
  "/tax",
  "/savings",
  "/settings",
  "/portfolios",
  "/admin",
  "/corporate-actions",
] as const;

/** Where "Back" goes without a usable referrer: the tab that owns /instruments. */
const DEFAULT_BACK_TARGET = "/holdings";

/** The referring route's path (locale prefix stripped), or null when there is none. */
function referringPath(referer: string | null | undefined): string | null {
  if (!referer) return null;
  let pathname: string;
  try {
    // The base only matters for a bare path (and normalizes ".."); an absolute referer
    // ignores it.
    pathname = new URL(referer, "http://referrer.invalid").pathname;
  } catch {
    return null;
  }
  const segments = pathname.split("/").filter(Boolean);
  // Strip the locale prefix (/en/trades → /trades).
  const locales = routing.locales as readonly string[];
  if (segments.length > 1 && locales.includes(segments[0])) segments.shift();
  return segments.length ? "/" + segments.join("/") : null;
}

/**
 * The instrument detail is reachable from four different tables, so "Back" returns to the
 * route the instrument was actually opened from (the `Referer` header) instead of always
 * to /holdings. A direct link (no referrer) or a referrer to a route the app does not
 * have falls back to /holdings — the tab that owns /instruments (see `navActiveKey`).
 */
function backTargetFrom(referer: string | null | undefined): string {
  const path = referringPath(referer);
  if (!path) return DEFAULT_BACK_TARGET;
  const known = BACK_TARGET_ROUTES.some((route) => path === route || path.startsWith(route + "/"));
  return known ? path : DEFAULT_BACK_TARGET;
}

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

  // "Back" follows the route the instrument was opened from (the table the user clicked
  // through); without a referrer it falls back to /holdings.
  let backTarget = DEFAULT_BACK_TARGET;
  try {
    backTarget = backTargetFrom((await headers()).get("referer"));
  } catch {
    // No request context (e.g. a build-time render) — keep the default.
  }

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
          <BackLink href={backTarget} className="md:flex" />
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
          <BackLink href={backTarget} className="md:flex" />
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
      <PageHeaderSetter title={heroName} backHref={backTarget} />
      <InstrumentVisitTracker id={id} symbol={instrument.symbol} />
      <InstrumentHeader instrument={instrument} heroName={heroName} isAdmin={isAdmin} />

      <PageWithRail size="narrow">
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
        <PageRail className="space-y-6">
          <Suspense fallback={<InstrumentCardSkeleton />}>
            <InstrumentPositionSection id={id} locale={locale} />
          </Suspense>
        </PageRail>
      </PageWithRail>
    </div>
  );
}

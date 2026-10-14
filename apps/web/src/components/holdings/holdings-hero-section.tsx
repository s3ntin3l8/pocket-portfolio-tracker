import type { HistoryPoint, NetWorth } from "@portfolio/api-client";
import { HeroGlanceCard } from "@/components/holdings/hero-glance-card";
import { isIntradayHeroRange, resolveHeroRange, type HeroRange } from "@/lib/chart-range";
import {
  loadHasIntraday,
  loadNetWorthHistory,
  loadNetWorthHolderScope,
  getSelectedPortfolioId,
} from "@/lib/server-api";

export interface HoldingsHeroData {
  heroRange: HeroRange;
  history: HistoryPoint[];
  selectedId: string | null;
  holderId: string | undefined;
  hasIntraday: boolean | "unavailable";
}

/**
 * Kick off the hero's independent loaders. Called by the page right at the start of its
 * render (NOT awaited there) and handed to {@link HoldingsHeroSection} as a promise, so the
 * history fetch runs in parallel with the page's blocking holdings fetch while the hero
 * itself streams in behind a `<Suspense>` — without the start-after-blocking waterfall that
 * fetching inside the section would introduce.
 *
 * `?range=` deep link: the hero opens on it, except that an intraday range with no intraday
 * data (its chips are hidden) falls back to the default.
 */
export function startHoldingsHeroData(rangeParam?: string): Promise<HoldingsHeroData> {
  const run = async (): Promise<HoldingsHeroData> => {
    const hasIntradayPromise = loadHasIntraday();
    const heroRange =
      rangeParam && isIntradayHeroRange(rangeParam)
        ? resolveHeroRange(rangeParam, await hasIntradayPromise)
        : resolveHeroRange(rangeParam);
    const [history, selectedId, holderId, hasIntraday] = await Promise.all([
      loadNetWorthHistory(heroRange),
      getSelectedPortfolioId(),
      loadNetWorthHolderScope(),
      hasIntradayPromise,
    ]);
    return { heroRange, history, selectedId, holderId, hasIntraday };
  };
  const promise = run();
  // If the page bails out before rendering the hero (error / empty state), nobody awaits
  // this — don't let a rejection surface as an unhandled one.
  promise.catch(() => {});
  return promise;
}

/**
 * The Holdings hero (net worth + range chart). A server component that does its own
 * awaiting (of `data`), so the page can stream it behind a `<Suspense>` while the positions
 * table — which only needs the already-resolved holdings payload — paints first. The
 * net-worth figure comes from `summary`, which the page resolved on its blocking path (it
 * shares one cached API call with the holdings).
 */
export async function HoldingsHeroSection({
  summary,
  data,
  portfolioParam,
  benchmarkSymbol,
}: {
  summary: NetWorth;
  data: Promise<HoldingsHeroData>;
  portfolioParam?: string;
  benchmarkSymbol: string;
}) {
  const { heroRange, history, selectedId, holderId, hasIntraday } = await data;

  return (
    <HeroGlanceCard
      // Remount on a scope change: the chart seeds its state from `initialHistory`.
      key={`${portfolioParam ?? ""}:${selectedId ?? ""}:${holderId ?? ""}`}
      netWorth={summary.netWorth}
      currency={summary.displayCurrency}
      initialHistory={history}
      initialRange={heroRange}
      hasIntraday={hasIntraday}
      selectedId={selectedId}
      holderId={holderId}
      benchmarkSymbol={benchmarkSymbol}
      atCostCount={summary.holdings.filter((h) => h.valuedAtCost).length}
      fxMissingCount={summary.holdings.filter((h) => h.fxMissing).length}
      atCostHref={
        portfolioParam
          ? `/holdings?portfolio=${portfolioParam}&filter=at-cost`
          : "/holdings?filter=at-cost"
      }
    />
  );
}

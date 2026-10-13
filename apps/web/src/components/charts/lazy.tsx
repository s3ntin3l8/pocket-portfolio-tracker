"use client";

import dynamic from "next/dynamic";
import { ChartSkeleton } from "@/components/charts/chart-skeleton";

/**
 * Code-split entry points for the Recharts-based charts (audit D11). Recharts is ~100 kB
 * gzipped; importing a chart statically from a page pulls it into that route's first-load
 * JS even when the chart sits below the fold. These wrappers move each chart into its own
 * chunk, fetched on demand.
 *
 * - `Lazy*` — `ssr: false`: for charts below the fold / behind a tab, rendered client-side
 *   once the chunk arrives (skeleton in the meantime).
 * - `*Ssr` — still server-rendered, for the above-the-fold chart on Holdings so it paints
 *   with the HTML; the code is merely split into its own chunk.
 *
 * This module is a Client Component so server pages can import it directly (`ssr: false`
 * is only legal in client modules).
 */
const loading = () => <ChartSkeleton />;

export const LazyAllocationDonut = dynamic(
  () => import("@/components/charts/allocation-donut").then((m) => m.AllocationDonut),
  { ssr: false, loading },
);
export const AllocationDonutSsr = dynamic(
  () => import("@/components/charts/allocation-donut").then((m) => m.AllocationDonut),
  { loading },
);
export const LazyIncomeBarChart = dynamic(
  () => import("@/components/charts/income-bar-chart").then((m) => m.IncomeBarChart),
  { ssr: false, loading },
);
export const LazyContributionsChart = dynamic(
  () => import("@/components/charts/contributions-chart").then((m) => m.ContributionsChart),
  { ssr: false, loading },
);
export const LazyYearlyReturnsCard = dynamic(
  () => import("@/components/insights/yearly-returns-card").then((m) => m.YearlyReturnsCard),
  { ssr: false, loading },
);
export const LazyForecastChart = dynamic(
  () => import("@/components/charts/forecast-chart").then((m) => m.ForecastChart),
  { ssr: false, loading },
);
export const LazyPriceChart = dynamic(
  () => import("@/components/charts/price-chart").then((m) => m.PriceChart),
  { ssr: false, loading },
);
export const PriceChartSsr = dynamic(
  () => import("@/components/charts/price-chart").then((m) => m.PriceChart),
  { loading },
);
export const HeroOverlayChartSsr = dynamic(
  () => import("@/components/charts/hero-overlay-chart").then((m) => m.HeroOverlayChart),
  { loading },
);
export const LazyRevenueEarningsChart = dynamic(
  () => import("@/components/charts/revenue-earnings-chart").then((m) => m.RevenueEarningsChart),
  { ssr: false, loading },
);
export const LazyEpsActualEstimateChart = dynamic(
  () =>
    import("@/components/charts/eps-actual-estimate-chart").then((m) => m.EpsActualEstimateChart),
  { ssr: false, loading },
);

"use client";

import { useTranslations } from "next-intl";
import { PiggyBank } from "lucide-react";
import { PriceChart } from "@/components/charts/price-chart";
import { EmptyState } from "@/components/empty-state";

/**
 * Cumulative contributions over time. Takes the per-month net-contribution
 * series and renders the running total as an area, reusing {@link PriceChart}.
 */
export function ContributionsChart({
  series,
  currency,
}: {
  series: { month: string; contributed: string }[];
  currency: string;
}) {
  const te = useTranslations("Empty");

  // Running total as a prefix sum — kept reassignment-free so the React Compiler
  // lint (react-hooks) can memoize it (series is a short monthly list).
  const points = series.map((s, i) => ({
    date: s.month,
    close: series
      .slice(0, i + 1)
      .reduce((sum, x) => sum + Number(x.contributed), 0)
      .toString(),
  }));

  if (points.length < 2) {
    return (
      <EmptyState
        icon={PiggyBank}
        title={te("historyTitle")}
        description={te("historyBody")}
      />
    );
  }

  return <PriceChart data={points} currency={currency} />;
}

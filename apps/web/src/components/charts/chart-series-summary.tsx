"use client";

import { useTranslations } from "next-intl";

/**
 * The text equivalent of a chart's series (audit E8).
 *
 * A chart is a graphic — a screen reader cannot read the line, and neither can anyone
 * who cannot see it. This renders the same data as text: the first, last, lowest and
 * highest point of the plotted series. It stays visually hidden, so the graphic remains
 * the primary representation and sighted users see no change.
 */
export function ChartSeriesSummary({
  values,
  format,
  label,
}: {
  /** The plotted values. Non-numeric and missing points are ignored. */
  values: ReadonlyArray<number | null | undefined>;
  /** Formats one value for display. */
  format: (value: number) => string;
  /** What the series is — e.g. "Closing price". */
  label?: string;
}) {
  const t = useTranslations("A11y");
  const points = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  // A series needs at least two points: with one point, first = last = lowest = highest
  // and the summary says nothing the chart's own label doesn't.
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];
  const min = Math.min(...points);
  const max = Math.max(...points);

  return (
    <p className="sr-only">
      {label ? `${label}: ` : ""}
      {t("chartSummaryTitle")} — {t("chartSummaryFirst")}: {format(first)}, {t("chartSummaryLast")}:{" "}
      {format(last)}, {t("chartSummaryMin")}: {format(min)}, {t("chartSummaryMax")}: {format(max)}.
    </p>
  );
}

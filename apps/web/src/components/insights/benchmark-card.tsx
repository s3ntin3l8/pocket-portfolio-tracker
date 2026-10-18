"use client";

import { signToneClass } from "@/lib/tone";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatPercent, formatPercentUnsigned } from "@/lib/utils";
import { benchmarkLabel } from "@/lib/benchmark-labels";
import { EditBenchmarkDialog } from "./edit-benchmark-dialog";
import type { BenchmarkSymbolEntry, InsightsBenchmark } from "@portfolio/api-client";

export function BenchmarkCard({
  benchmark,
  symbols,
  locale,
}: {
  benchmark: InsightsBenchmark | null;
  symbols: BenchmarkSymbolEntry[];
  locale: string;
}) {
  const t = useTranslations("Insights.benchmark");
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!benchmark) {
    return (
      <Card className="rounded-lg bg-card p-4 shadow-card">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary">
            <TrendingUp className="size-5 text-text-2" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{t("setBenchmark")}</p>
            <p className="mt-0.5 text-xs text-text-2">{t("setBenchmarkHint")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
            {t("setBenchmark")}
          </Button>
        </div>
        <EditBenchmarkDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          currentSymbols={symbols}
        />
      </Card>
    );
  }

  const activeReturn = Number(benchmark.activeReturn);
  // null (or absent, from an older API) = not measurable ("—"); a measured 0 is a real 0.00%
  // (an exactly-replicated index).
  const trackingError = benchmark.trackingError == null ? null : Number(benchmark.trackingError);
  const correlation = Number(benchmark.correlation);
  // Active return is cumulative portfolio return minus cumulative benchmark return over the
  // whole window, not an annual figure — say so, next to the per-year table on the page.
  const since = benchmark.since
    ? new Intl.DateTimeFormat(locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(
        new Date(`${benchmark.since}T00:00:00Z`),
      )
    : null;

  return (
    <Card className="group relative rounded-lg bg-card p-4 shadow-card">
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="touch-target absolute right-3 top-3 flex size-7 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent"
        aria-label={t("editBenchmark")}
      >
        <Pencil className="size-3.5 text-text-2" />
      </button>
      <p className="text-xs font-semibold text-text-2">
        {t("vs", { symbol: benchmarkLabel(benchmark.symbol) })}
      </p>
      <p
        className={cn(
          "tabular mt-1 text-heading font-bold leading-none",
          signToneClass(activeReturn),
        )}
      >
        {formatPercent(activeReturn, locale)}
      </p>
      <p className="mt-1 text-xs font-medium text-text-2">
        {since ? t("activeReturnSince", { date: since }) : t("activeReturn")}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-2">
        <span>
          {t("trackingError")}:{" "}
          <span className="font-semibold">
            {trackingError === null ? "—" : formatPercentUnsigned(trackingError, locale)}
          </span>
        </span>
        <span>
          {t("correlation")}:{" "}
          <span className="font-semibold">{correlation ? correlation.toFixed(2) : "—"}</span>
        </span>
      </div>
      <EditBenchmarkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentSymbols={symbols}
      />
    </Card>
  );
}

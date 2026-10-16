import { TriangleAlert, Info, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { Separator } from "@/components/ui/separator";
import type { TaxDistribution, AllowanceUsage } from "@portfolio/api-client";

/** Loosely-typed next-intl translator scoped to the `Tax` namespace — the same shape as
 *  `getTranslations("Tax")` (server) or `useTranslations("Tax")` (client), threaded down
 *  as a prop rather than re-derived in each subcomponent. */
export type TaxTranslator = (key: string, values?: Record<string, string | number>) => string;

/** The "Estimated tax" hero stat — gradient card, distinct from the plain `StatCard`
 *  tiles beside it (the design's one visually-emphasized headline figure). `tone`
 *  matches the regime: violet for German (Abgeltungsteuer), green for Indonesian
 *  (final tax) — exactly `TaxScreen.dc.html`'s two hero gradients. */
export function EstimatedTaxHero({
  label,
  value,
  description,
  tone = "violet",
}: {
  label: string;
  value: string;
  description: string;
  tone?: "violet" | "green";
}) {
  return (
    <div
      className="min-w-0 rounded-xl p-5 text-white"
      style={{
        background:
          tone === "green"
            ? "linear-gradient(135deg,var(--primary),var(--primary-deep))"
            : "linear-gradient(135deg,var(--violet),var(--violet-deep))",
      }}
    >
      <p className="truncate text-xs font-semibold text-white/80">{label}</p>
      <p className="tabular mt-1 truncate text-lg font-extrabold sm:text-2xl lg:text-display">
        {value}
      </p>
      <p className="mt-1 text-xs font-medium text-white/80">{description}</p>
    </div>
  );
}

/** The tax-loss-harvesting card's always-visible allowance summary: "Allowance left"
 *  (with a progress bar) and "Taxable gains YTD" — a 2-box relayout of the same
 *  `allowanceUsage` figures the page used to show as a 3-up `StatCard` row + separate
 *  progress-bar card. Every figure from the old layout is preserved here. */
export function AllowanceSummaryBoxes({
  usedPct,
  allowanceAnnual,
  usedYtd,
  remaining,
  taxSavingAvailable,
  taxable,
  estimatedTax,
  money,
  t,
}: {
  usedPct: number;
  allowanceAnnual: string;
  usedYtd: string;
  remaining: string;
  /** Tax that using up the *remaining* allowance would save (`allowanceUsage.taxSavingAvailable`)
   *  — distinct from `estimatedTax` below (tax owed on gains ALREADY past the allowance).
   *  Carried over from the old 3-up StatCard row's "Remaining" delta so this figure isn't lost. */
  taxSavingAvailable: string;
  taxable: string;
  estimatedTax: string;
  money: (n: string | number) => string;
  t: TaxTranslator;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border bg-card-2 px-[15px] py-[13px]">
        <div className="flex items-baseline justify-between">
          <span className="text-micro font-semibold text-text-2">{t("allowanceBoxes.left")}</span>
          <span className="tabular text-body font-bold">{money(remaining)}</span>
        </div>
        {/* Reference: 7px track, purple allowance fill (#7C5CFC is the tax screen's accent). */}
        <div className="mt-2 h-[7px] overflow-hidden rounded-xs bg-line">
          <div
            className="h-full rounded-xs transition-all"
            style={{
              width: `${Math.min(100, Math.max(0, usedPct))}%`,
              backgroundColor: "var(--violet)",
            }}
          />
        </div>
        <p className="mt-1.5 text-micro font-medium text-text-2">
          {t("allowanceBoxes.leftDesc", { used: money(usedYtd), annual: money(allowanceAnnual) })}
        </p>
        <p className="mt-1 text-micro font-medium text-text-2">
          {t("allowance.taxSaving")}: {money(taxSavingAvailable)}
        </p>
      </div>
      <div className="rounded-lg border bg-card-2 px-[15px] py-[13px]">
        <span className="text-micro font-semibold text-text-2">
          {t("allowanceBoxes.taxableGains")}
        </span>
        <p className="tabular mt-1.5 text-xl font-bold">{money(taxable)}</p>
        <p className="mt-1 text-micro font-medium text-text-2">
          {t("allowanceBoxes.taxableGainsDesc", { tax: money(estimatedTax) })}
        </p>
      </div>
    </div>
  );
}

export function DistributionCard({
  distribution: d,
  money,
  t,
}: {
  distribution: TaxDistribution;
  money: (n: string | number) => string;
  t: TaxTranslator;
}) {
  const allocPct =
    Number(d.holderAllowanceCap) > 0
      ? Math.round((Number(d.totalAllocated) / Number(d.holderAllowanceCap)) * 100)
      : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="size-4" />
          {t("distribution.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
          <StatCard
            label={t("distribution.cap")}
            value={money(d.holderAllowanceCap)}
            delta={t("distribution.capDesc")}
          />
          <StatCard
            label={t("distribution.allocated")}
            value={money(d.totalAllocated)}
            delta={`${allocPct}%`}
          />
          <StatCard
            label={t("distribution.remaining")}
            value={money(d.remainingToDistribute)}
            delta={t("distribution.remainingDesc")}
          />
        </div>
        {d.overAllocated && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warn-strong">
            <TriangleAlert className="size-4 mt-0.5 shrink-0" />
            <span>{t("distribution.overAllocated")}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function VorabpauschaleRow({
  allowanceUsage: u,
  money,
  t,
}: {
  allowanceUsage: AllowanceUsage;
  money: (n: string | number) => string;
  t: TaxTranslator;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4">
      <StatCard
        label={t("vorabpauschale.accrued")}
        value={money(u.vorabpauschaleAccrued)}
        delta={t("vorabpauschale.accruedDesc")}
        basis={u.vorabpauschaleEstimated ? t("vorabpauschale.estimatedBasis") : undefined}
      />
      <StatCard
        label={t("vorabpauschale.credited")}
        value={money(u.vorabpauschaleCredited)}
        delta={t("vorabpauschale.creditedDesc")}
      />
    </div>
  );
}

function PotCard({
  title,
  desc,
  netGainLoss,
  used,
  carryForward,
  money,
  t,
}: {
  title: string;
  desc: string;
  netGainLoss: string;
  used: string;
  carryForward: string;
  money: (n: string | number) => string;
  t: TaxTranslator;
}) {
  return (
    <div className="rounded-lg border bg-card-2 px-[15px] py-[13px]">
      <span className="text-micro font-semibold text-text-2">{title}</span>
      <p className="mt-0.5 text-micro text-text-2">{desc}</p>
      <div className="mt-2 space-y-1">
        <div className="flex justify-between text-micro">
          <span className="text-text-2">{t("coverage.pots.net")}</span>
          <span className="tabular font-bold">{money(netGainLoss)}</span>
        </div>
        <div className="flex justify-between text-micro">
          <span className="text-text-2">{t("coverage.pots.used")}</span>
          <span className="tabular font-bold">{money(used)}</span>
        </div>
        {Number(carryForward) > 0 && (
          <div className="flex justify-between text-micro">
            <span className="text-text-2">{t("coverage.pots.carryForward")}</span>
            <span className="tabular font-bold">{money(carryForward)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function CoverageCard({
  allowanceUsage: u,
  money,
  locale,
  t,
}: {
  allowanceUsage: AllowanceUsage;
  money: (n: string | number) => string;
  locale: string;
  t: TaxTranslator;
}) {
  const hasFsa = Number(u.allowanceAnnual) > 0;
  const usedPct = hasFsa ? Math.round((Number(u.usedYtd) / Number(u.allowanceAnnual)) * 100) : 0;
  // Read what the backend actually applied (stockPot/generalPot.carryForwardApplied is
  // "0.00" whenever the multi-depot rule declines to apply it — see tax.test.ts), not
  // the raw configured row, so this can't overstate coverage the numbers below don't
  // reflect.
  const cfStock = u.stockPot.carryForwardApplied;
  const cfGeneral = u.generalPot.carryForwardApplied;
  const hasCf = Number(cfStock) > 0 || Number(cfGeneral) > 0;
  const isTaxable = Number(u.taxableExcess) > 0;
  const hasLoss = !isTaxable && Number(u.realizedGainsAdjusted) < 0;
  const ratePct = (Number(u.taxRate) * 100).toLocaleString(locale, {
    maximumFractionDigits: 3,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="size-4" />
          {t("coverage.title", { year: u.year })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasFsa ? (
          <div className="rounded-lg border bg-card-2 px-[15px] py-[13px]">
            <span className="text-micro font-semibold text-text-2">{t("coverage.fsa.title")}</span>
            <p className="tabular mt-1 text-body font-bold">
              {t("coverage.fsa.usedDesc", {
                used: money(u.usedYtd),
                annual: money(u.allowanceAnnual),
              })}
            </p>
            <div className="mt-2 h-[7px] overflow-hidden rounded-xs bg-line">
              <div
                className="h-full rounded-xs transition-all"
                style={{
                  width: `${Math.min(100, Math.max(0, usedPct))}%`,
                  backgroundColor: "var(--violet)",
                }}
              />
            </div>
            <p className="mt-1.5 text-micro font-medium text-text-2">
              {isTaxable ? t("coverage.fsa.exceeded") : t("coverage.fsa.allUsed")}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card-2 px-[15px] py-[13px]">
            <span className="text-micro font-semibold text-text-2">{t("coverage.fsa.title")}</span>
            <p className="mt-1 text-sm text-muted-foreground">{t("coverage.fsa.noFsa")}</p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PotCard
            title={t("coverage.pots.stock")}
            desc={t("coverage.pots.stockDesc")}
            netGainLoss={u.stockPot.netGainLoss}
            used={u.stockPot.used}
            carryForward={cfStock}
            money={money}
            t={t}
          />
          <PotCard
            title={t("coverage.pots.general")}
            desc={t("coverage.pots.generalDesc")}
            netGainLoss={u.generalPot.netGainLoss}
            used={u.generalPot.used}
            carryForward={cfGeneral}
            money={money}
            t={t}
          />
        </div>

        {hasCf ? (
          <p className="text-micro font-medium text-text-2">{t("coverage.pots.editorHint")}</p>
        ) : null}

        <Separator />

        {isTaxable ? (
          <div>
            <p className="text-sm">
              {t("coverage.summary.taxable")}: {money(u.taxableExcess)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("coverage.summary.abgeltungsteuer", { rate: ratePct })} ·{" "}
              {money(Number(u.taxableExcess) * Number(u.taxRate))} ·{" "}
              {t("coverage.summary.withheld")}
            </p>
          </div>
        ) : hasLoss ? (
          <p className="text-sm font-medium text-muted-foreground">
            {t("coverage.summary.noTax")} · {money(Math.abs(Number(u.realizedGainsAdjusted)))}
          </p>
        ) : (
          <p className="text-sm font-medium text-muted-foreground">
            {t("coverage.summary.coveredByFsa")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// Re-exported so existing importers keep working.
export { HarvestSummaryNote, HarvestRow } from "./harvest-cards";

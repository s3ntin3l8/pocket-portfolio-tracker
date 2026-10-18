import { CircleCheck } from "lucide-react";
import { InstrumentLogo } from "@/components/instrument-logo";
import { Link } from "@/i18n/navigation";
import { tint } from "@/lib/tint";
import type { HarvestSuggestion } from "@portfolio/api-client";
import type { HarvestSummary } from "@portfolio/core";
import type { TaxTranslator } from "./tax-cards";

/** Footer sentence aggregating every harvestable position currently shown. */
export function HarvestSummaryNote({
  suggestions,
  combined,
  money,
  t,
}: {
  suggestions: HarvestSuggestion[];
  /** Combined "harvest all of these together" totals from core's `harvestSummary` —
   *  sequentially allocates the SHARED remaining allowance across `suggestions`, unlike
   *  each row's own `harvestableGross`/`taxSaving`, which are independently capped
   *  against the FULL remaining allowance (correct in isolation, wrong summed — see
   *  `harvestSummary`'s doc comment in packages/core/src/tax.ts). `combined.plan` names
   *  the SPECIFIC position(s) actually needed — usually far fewer than `suggestions`,
   *  since one large-enough gain can exhaust the whole remaining allowance on its own. */
  combined: HarvestSummary;
  money: (n: string | number) => string;
  t: TaxTranslator;
}) {
  const totalHarvestable = Number(combined.combinedHarvestableGross);
  const totalSaving = Number(combined.combinedTaxSaving);
  if (totalHarvestable <= 0) return null;

  // Name the plan's position(s) by symbol — same fallback HarvestRow uses, so a
  // suggestion referenced here reads identically to its row further down. Joined with a
  // plain comma (no locale-specific "and") — mirrors the dividendTotalsByCurrency
  // "joined, not summed" precedent elsewhere on this page.
  const nameById = new Map(
    suggestions.map((s) => [s.instrumentId, s.instrument?.symbol ?? s.instrumentId.slice(0, 8)]),
  );
  const positionNames = combined.plan
    .map((step) => nameById.get(step.instrumentId) ?? step.instrumentId.slice(0, 8))
    .join(", ");
  const remainingCount = suggestions.length - combined.plan.length;

  // Partial: some suggestions weren't needed at all — the common case, since the first
  // (best) position(s) usually exhaust the remaining allowance alone. Full: every listed
  // suggestion is part of the plan (either because together they exactly cover the
  // allowance, or because total available gains fall short of it). Two partial variants
  // (not an ICU plural) — `t` here is a directly-injected translator (see TaxTranslator's
  // doc comment), not guaranteed to run through next-intl's real ICU MessageFormat in
  // every caller (e.g. this component's unit tests use a plain-substitution stub).
  const summaryText =
    remainingCount > 0
      ? t(remainingCount === 1 ? "harvest.summary.partialOne" : "harvest.summary.partialMany", {
          positions: positionNames,
          offset: money(totalHarvestable),
          saving: money(totalSaving),
          remainingCount,
        })
      : t("harvest.summary.full", {
          count: combined.plan.length,
          positions: positionNames,
          offset: money(totalHarvestable),
          saving: money(totalSaving),
        });

  return (
    <div className="flex items-start gap-2.5 border-t border-card-2 bg-success/10 px-[22px] py-3.5">
      <CircleCheck className="mt-px size-[17px] shrink-0 text-success" />
      <p className="text-xs font-medium leading-relaxed text-text-mute">{summaryText}</p>
    </div>
  );
}

export function HarvestRow({
  s,
  money,
  t,
}: {
  s: HarvestSuggestion;
  money: (n: string | number) => string;
  t: TaxTranslator;
}) {
  const tfPct = Math.round(parseFloat(s.tfRate) * 100);
  const label = s.instrument?.symbol ?? s.instrumentId.slice(0, 8);

  // Reference single-row layout: monogram | name + one meta line | gain + sublabel | CTA.
  return (
    <div className="flex items-center gap-3 border-t border-card-2 px-[22px] py-3 first:border-t-0">
      <InstrumentLogo
        label={label}
        symbol={s.instrument?.symbol}
        market={s.instrument?.market}
        assetClass={s.instrument?.assetClass}
        className="size-[38px]"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-bold">{s.instrument?.name ?? label}</p>
        <p className="truncate text-micro font-medium text-text-2">
          {t("harvest.metaLine", { offset: money(s.harvestableGross), saving: money(s.taxSaving) })}
          {tfPct > 0 && (
            <>
              {" "}
              {" · "}
              {t("harvest.tfApplied", { pct: tfPct })}
            </>
          )}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {/* Our German model harvests unrealized GAINS within the allowance → shown green. */}
        <p className="tabular text-body-sm font-bold text-success">{money(s.unrealizedGross)}</p>
        <p className="text-micro font-semibold text-text-2">{t("harvest.unrealized")}</p>
      </div>
      {/* Stays on /tax (unlike the retired `/transactions/new` full page) — the shell's
          `AddTransactionMenu` picks up `?harvestInstrument=` reactively and opens the Add
          sheet on a prefilled Sell draft, matching the app's one everyday add flow. */}
      <Link
        href={`/tax?harvestInstrument=${s.instrumentId}`}
        className="shrink-0 rounded-sm px-[13px] py-2 text-xs font-bold text-violet transition-transform active:scale-95"
        style={{ backgroundColor: tint("violet").bg }}
      >
        {t("harvest.button")}
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indonesian final-tax tables (IdIncomeTable, IdForeignIncomeTable, IdByYearTable) live in
// ./tax-tables.tsx alongside their German counterparts — both regimes' tables need
// client-side sort state, so they share a "use client" module. This file stays a
// server component for the non-table bits (hero card, allowance boxes, harvest
// rows, distribution card, harvest summary note).
//
// `IdSalesTable` (the disposals table) lives in ./disposal-table.tsx alongside its
// German counterpart `DisposalTable` — both need client-side row-expansion state
// for the aggregate-disposal/per-lot-detail view.
// ---------------------------------------------------------------------------

import { Decimal } from "decimal.js";
import { collectFxMissing } from "@/lib/fx-missing";
import type { TaxSummaryHolder, PortfolioTaxSummary } from "@portfolio/api-client";
import {
  TAXED_INCOME_TYPES,
  mergeIndonesianFinalTax,
  type IdCashIncomeSource,
} from "@portfolio/core";
import {
  getServerApi,
  listPortfoliosCached,
  listAccountHoldersCached,
  getSelectedPortfolioId,
  resolveHolderScope,
  ID_ALL_PORTFOLIOS_ID,
  type TaxDisposalRow,
  type TaxDisposalLot,
  type TaxDividendRow,
  type TaxCurrencyTotal,
  type TaxYearRow,
  type TaxYearDetail,
  type IndonesianFinalTaxLike,
  type TaxSummaryHolderWithCarryForward,
} from "./_shared";
import { loadPreferences } from "./user";
import { classifyFailure, type DataFailure } from "@/lib/data-status";

export type NetworthTaxResult =
  { status: "ok"; holders: TaxSummaryHolderWithCarryForward[] } | DataFailure;

/**
 * Like `loadNetworthTax`, but distinguishes "no tax data" (`ok` with no holders) from a
 * failed load (`unauthorized` / `rate_limited` / `unavailable`) so the Tax and Reports
 * pages don't show the empty copy — or a silently partial page — when the API is down.
 */
export async function loadNetworthTaxResult(
  year?: number,
  taxRegime: "DE" | "ID" = "DE",
): Promise<NetworthTaxResult> {
  if (!(await getServerApi())) return { status: "unauthorized" };
  try {
    return { status: "ok", holders: await fetchNetworthTax(year, taxRegime, true) };
  } catch (err) {
    return classifyFailure(err);
  }
}

export async function loadNetworthTax(
  year?: number,
  taxRegime: "DE" | "ID" = "DE",
): Promise<TaxSummaryHolderWithCarryForward[]> {
  return fetchNetworthTax(year, taxRegime, false);
}

/** `rethrow` false swallows failures into `[]` (legacy contract); true propagates them. */
async function fetchNetworthTax(
  year: number | undefined,
  taxRegime: "DE" | "ID",
  rethrow: boolean,
): Promise<TaxSummaryHolderWithCarryForward[]> {
  const api = await getServerApi();
  if (!api) return [];
  try {
    const portfolios = await listPortfoliosCached();
    if (portfolios.length === 0) return [];

    const wanted = await getSelectedPortfolioId();
    const selected = portfolios.find((p) => p.id === wanted);
    const targetYear = year ?? new Date().getUTCFullYear();

    if (taxRegime === "ID") {
      const zeroAllowance = {
        year: targetYear,
        allowanceAnnual: "0",
        realizedGainsAdjusted: "0",
        incomeYtd: "0",
        vorabpauschaleAccrued: "0",
        vorabpauschaleCredited: "0",
        stockPot: { netGainLoss: "0", carryForwardApplied: "0", used: "0" },
        generalPot: { netGainLoss: "0", carryForwardApplied: "0", used: "0" },
        usedYtd: "0",
        taxableExcess: "0",
        remaining: "0",
        taxRate: "0",
        taxSavingAvailable: "0",
        currency: selected?.baseCurrency ?? "IDR",
        forecastIncomeRestOfYear: "0",
        projectedUsedFullYear: "0",
        projectedRemaining: "0",
        projectedTaxSavingAvailable: "0",
      };
      const zeroDistribution = {
        holderAllowanceCap: "0",
        totalAllocated: "0",
        remainingToDistribute: "0",
        overAllocated: false,
      };

      if (selected) {
        return [
          {
            holder: {
              id: selected.accountHolderId ?? selected.id,
              name: selected.accountHolder ?? selected.name,
              taxAllowanceAnnual: selected.taxAllowanceAnnual,
              capitalGainsTaxRate: null,
              churchTax: null,
              taxResidence: null,
            },
            year: targetYear,
            currency: zeroAllowance.currency,
            allowanceUsage: zeroAllowance,
            harvestSuggestions: [],
            carryForwardApplied: false,
            accountHolderId: selected.accountHolderId ?? null,
            distribution: zeroDistribution,
            tfRatesByInstrument: {},
          },
        ];
      }

      const holderId = await resolveHolderScope(portfolios);
      let holderName = "";
      if (holderId) {
        const holders = await listAccountHoldersCached();
        holderName = holders.find((h) => h.id === holderId)?.name ?? "";
      }

      return [
        {
          holder: {
            id: holderId ?? ID_ALL_PORTFOLIOS_ID,
            name: holderName,
            taxAllowanceAnnual: null,
            capitalGainsTaxRate: null,
            churchTax: null,
            taxResidence: null,
          },
          year: targetYear,
          currency: zeroAllowance.currency,
          allowanceUsage: zeroAllowance,
          harvestSuggestions: [],
          carryForwardApplied: false,
          accountHolderId: holderId ?? null,
          distribution: zeroDistribution,
          tfRatesByInstrument: {},
        },
      ];
    }

    if (selected) {
      let result: PortfolioTaxSummary;
      try {
        result = await api.getPortfolioTax(selected.id, year);
      } catch (err: unknown) {
        if (
          err &&
          typeof err === "object" &&
          "status" in err &&
          (err as { status: number }).status === 422
        ) {
          return [];
        }
        throw err;
      }
      const holderEntry: TaxSummaryHolderWithCarryForward = {
        holder: {
          id: selected.accountHolderId ?? selected.id,
          name: selected.accountHolder ?? selected.name,
          taxAllowanceAnnual: selected.taxAllowanceAnnual,
          capitalGainsTaxRate: null,
          churchTax: null,
          taxResidence: null,
        },
        year: result.year,
        currency: result.currency,
        allowanceUsage: result.allowanceUsage,
        harvestSuggestions: result.harvestSuggestions,
        carryForwardApplied: result.carryForwardApplied,
        accountHolderId: selected.accountHolderId ?? null,
        distribution: result.holderDistribution,
        tfRatesByInstrument: result.tfRatesByInstrument,
        ...(result.fxMissingCurrencies ? { fxMissingCurrencies: result.fxMissingCurrencies } : {}),
      };
      return [holderEntry];
    }

    const holderId = await resolveHolderScope(portfolios);
    const holders = await api.getNetworthTax(year, holderId);
    // /networth/tax always aggregates by a genuine account holder — holder.id here is
    // never a portfolio-id fallback.
    return holders.map((h) => ({ ...h, accountHolderId: h.holder.id }));
  } catch (err) {
    if (rethrow) throw err;
    return [];
  }
}

export async function loadTaxYearDetail(
  holders: TaxSummaryHolder[],
  year?: number,
): Promise<Map<string, TaxYearDetail>> {
  const result = new Map<string, TaxYearDetail>();
  if (holders.length === 0) return result;
  const api = await getServerApi();
  if (!api) return result;
  const targetYear = year ?? new Date().getUTCFullYear();
  // ID branch consumes the API's pre-computed `indonesianFinalTax` rather than re-deriving
  // the per-row numbers client-side. Without this flag the page renders the German
  // tables from `disposals`/`dividendRows` as before.
  const prefs = await loadPreferences();
  const regime: "DE" | "ID" = prefs?.taxRegime === "ID" ? "ID" : "DE";

  let portfolios: import("@portfolio/api-client").Portfolio[];
  let selected: import("@portfolio/api-client").Portfolio | undefined;
  try {
    portfolios = await listPortfoliosCached();
    const wanted = await getSelectedPortfolioId();
    selected = portfolios.find((p) => p.id === wanted);
  } catch {
    return result;
  }

  await Promise.all(
    holders.map(async (entry) => {
      const holderId = entry.holder.id;
      // The "all portfolios" sentinel is not a holder id: API filters take `undefined` for it.
      const apiHolderId = holderId === ID_ALL_PORTFOLIOS_ID ? undefined : holderId;
      const pfs = selected
        ? [selected]
        : holderId === ID_ALL_PORTFOLIOS_ID
          ? portfolios
          : portfolios.filter((p) => p.accountHolderId === holderId);
      if (pfs.length === 0) {
        // Synthetic / unallocated holder (no matching portfolio). Under ID, the
        // /networth/tax response already carries indonesianFinalTax on this entry.
        // Surface it directly so the reports headline isn't silently zero.
        if (regime === "ID" && entry.indonesianFinalTax) {
          result.set(holderId, {
            currency: entry.currency,
            fxMissingCurrencies: collectFxMissing(entry),
            disposals: [],
            totalProceeds: "0",
            totalGain: "0",
            dividendRows: [],
            dividendTotalsByCurrency: [],
            byYear: [],
            indonesianFinalTax: entry.indonesianFinalTax,
          });
        }
        return;
      }

      try {
        const [tradeLog, incomeLists, idTaxByPortfolio, idTaxByHolder] = await Promise.all([
          selected
            ? api.getTrades(selected.id, "fifo")
            : api.getNetWorthTrades("fifo", undefined, apiHolderId),
          Promise.all(pfs.map((p) => api.listIncomeByYear(p.id, targetYear))),
          regime === "ID" && selected
            ? api.getPortfolioTax(selected.id, targetYear)
            : Promise.resolve<PortfolioTaxSummary | null>(null),
          // W2 fix: the ID tax payload also needs to surface in the default aggregate
          // (no-selection) scope. /networth/tax returns one entry per holder with
          // indonesianFinalTax already populated under ID. Without this, the ID detail
          // section silently zeroed for the most common view.
          regime === "ID" && !selected
            ? api.getNetworthTax(targetYear, apiHolderId)
            : Promise.resolve<TaxSummaryHolder[] | null>(null),
        ]);
        const apiIdTax: IndonesianFinalTaxLike | undefined = selected
          ? idTaxByPortfolio?.indonesianFinalTax
          : (() => {
              // In the no-selection scope holderId is the "__id_all_portfolios__"
              // sentinel — never a real holder id. Combine every holder's ID tax payload
              // into one (same display currency); the core re-derives every total from the
              // rows, so no field can be dropped here.
              const parts = (idTaxByHolder ?? []).flatMap((h) =>
                h.indonesianFinalTax ? [h.indonesianFinalTax] : [],
              );
              if (parts.length === 0) return undefined;
              return mergeIndonesianFinalTax(parts);
            })();

        const disposalGroups = new Map<
          string,
          {
            symbol: string;
            when: string;
            instrumentId: string;
            proceeds: Decimal;
            gain: Decimal;
            quantity: Decimal;
            cost: Decimal;
            tfRate: Decimal;
            lots: TaxDisposalLot[];
          }
        >();
        for (const t of tradeLog.trades) {
          for (const l of t.legs) {
            if (l.taxYear !== targetYear) continue;
            const key = `${t.instrumentId}:${l.sellDate}`;
            const qty = new Decimal(l.quantity);
            const cost = new Decimal(l.cost);
            const proceeds = new Decimal(l.proceeds);
            const group = disposalGroups.get(key) ?? {
              symbol: t.instrument?.symbol ?? t.instrumentId.slice(0, 8),
              when: l.sellDate,
              instrumentId: t.instrumentId,
              proceeds: new Decimal(0),
              gain: new Decimal(0),
              quantity: new Decimal(0),
              cost: new Decimal(0),
              tfRate: new Decimal(entry.tfRatesByInstrument?.[t.instrumentId] ?? "0"),
              lots: [],
            };
            group.proceeds = group.proceeds.add(proceeds);
            group.gain = group.gain.add(new Decimal(l.gain));
            group.quantity = group.quantity.add(qty);
            group.cost = group.cost.add(cost);
            group.lots.push({
              acqDate: l.acqDate,
              quantity: l.quantity,
              buyPrice: qty.gt(0) ? cost.div(qty).toString() : "0",
              sellPrice: qty.gt(0) ? proceeds.div(qty).toString() : "0",
              proceeds: l.proceeds,
              gain: l.gain,
              holdingDays: l.holdingDays,
              longTerm: l.longTerm,
            });
            disposalGroups.set(key, group);
          }
        }
        const legs: TaxDisposalRow[] = [...disposalGroups.values()].map((g) => ({
          symbol: g.symbol,
          when: g.when,
          instrumentId: g.instrumentId,
          proceeds: g.proceeds.toFixed(2),
          gain: g.gain.toFixed(2),
          tfRate: g.tfRate.toString(),
          gainAdjusted: g.gain.mul(new Decimal(1).sub(g.tfRate)).toFixed(2),
          quantity: g.quantity.toString(),
          avgBuyPrice: g.quantity.gt(0) ? g.cost.div(g.quantity).toString() : "0",
          sellPrice: g.quantity.gt(0) ? g.proceeds.div(g.quantity).toString() : "0",
          lots: g.lots.sort((a, b) => a.acqDate.localeCompare(b.acqDate)),
        }));
        const totalProceeds = legs.reduce((s, l) => s.add(l.proceeds), new Decimal(0));
        const totalGain = legs.reduce((s, l) => s.add(l.gain), new Decimal(0));

        const incomeTxns = incomeLists.flat().filter(
          // Core's TAXED_INCOME_TYPES: the income types both tax views report, and the type of
          // `IdCashIncomeSource` (each has a `Tax.cashSource.<type>` label; tax-cards.test.tsx
          // checks the catalog).
          (t): t is typeof t & { type: IdCashIncomeSource["type"] } =>
            (TAXED_INCOME_TYPES as readonly string[]).includes(t.type) &&
            t.status !== "archived" &&
            t.status !== "draft" &&
            new Date(t.executedAt).getUTCFullYear() === targetYear,
        );
        const byInstrument = new Map<
          string,
          {
            symbol: string;
            cashType?: TaxDividendRow["cashType"];
            currency: string;
            net: Decimal;
            tax: Decimal;
          }
        >();
        for (const t of incomeTxns) {
          const qty = new Decimal(t.quantity);
          const net = (qty.gt(0) ? qty.mul(t.price) : new Decimal(t.price)).sub(t.fees ?? "0");
          const key = `${t.instrumentId ?? t.description ?? t.type}:${t.currency}`;
          const symbol =
            t.instrument?.symbol ?? t.description ?? t.instrumentId?.slice(0, 8) ?? t.type;
          const bucket = byInstrument.get(key) ?? {
            symbol,
            ...(!t.instrumentId && !t.description ? { cashType: t.type } : {}),
            currency: t.currency,
            net: new Decimal(0),
            tax: new Decimal(0),
          };
          bucket.net = bucket.net.add(net);
          bucket.tax = bucket.tax.add(new Decimal(t.tax ?? "0"));
          byInstrument.set(key, bucket);
        }
        const dividendRows: TaxDividendRow[] = [...byInstrument.values()].map((b) => ({
          symbol: b.symbol,
          ...(b.cashType ? { cashType: b.cashType } : {}),
          currency: b.currency,
          gross: b.net.add(b.tax).toFixed(2),
          tax: b.tax.toFixed(2),
          net: b.net.toFixed(2),
        }));
        const totalsByCurrencyMap = new Map<
          string,
          { gross: Decimal; tax: Decimal; net: Decimal }
        >();
        for (const r of dividendRows) {
          const t = totalsByCurrencyMap.get(r.currency) ?? {
            gross: new Decimal(0),
            tax: new Decimal(0),
            net: new Decimal(0),
          };
          t.gross = t.gross.add(r.gross);
          t.tax = t.tax.add(r.tax);
          t.net = t.net.add(r.net);
          totalsByCurrencyMap.set(r.currency, t);
        }
        const dividendTotalsByCurrency: TaxCurrencyTotal[] = [...totalsByCurrencyMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, t]) => ({
            currency,
            gross: t.gross.toFixed(2),
            tax: t.tax.toFixed(2),
            net: t.net.toFixed(2),
          }));

        const taxRate = new Decimal(entry.allowanceUsage?.taxRate ?? "0");
        const allowanceAnnual = new Decimal(entry.allowanceUsage?.allowanceAnnual ?? "0");
        const years = new Set<number>([
          ...tradeLog.realizedByYear.map((r) => r.year),
          ...tradeLog.dividendsByYear.map((d) => d.year),
        ]);
        const byYear: TaxYearRow[] = (
          [...years]
            .sort((a, b) => b - a)
            .map((y) => {
              if (y === entry.year) {
                const u = entry.allowanceUsage;
                if (!u) return null;
                const taxable = new Decimal(u.taxableExcess);
                return {
                  year: y,
                  realized: u.realizedGainsAdjusted,
                  dividends: u.incomeYtd,
                  tax: u.estimatedTax ?? taxable.mul(taxRate).toFixed(2),
                  fsaUsed: u.usedYtd,
                };
              }

              const realized = tradeLog.realizedByYear.find((r) => r.year === y)?.amount ?? "0";
              const divEntry = tradeLog.dividendsByYear.find((d) => d.year === y);
              const dividendsGross = divEntry
                ? new Decimal(divEntry.amount).add(divEntry.tax)
                : new Decimal(0);
              const realizedD = new Decimal(realized);
              const taxable = Decimal.max(0, realizedD.add(dividendsGross).sub(allowanceAnnual));
              const fsaUsed = Decimal.min(
                allowanceAnnual,
                Decimal.max(0, realizedD.add(dividendsGross)),
              );
              return {
                year: y,
                realized,
                dividends: dividendsGross.toFixed(2),
                tax: taxable.mul(taxRate).toFixed(2),
                fsaUsed: fsaUsed.toFixed(2),
              };
            }) as Array<TaxYearRow | null>
        ).filter((r): r is TaxYearRow => r !== null);

        result.set(holderId, {
          currency: tradeLog.displayCurrency,
          // Every payload this detail is built from — under ID the final-tax figures come
          // from these calls, not from the (synthetic) holder entry, so the page's FX
          // banner reads the misses here.
          fxMissingCurrencies: collectFxMissing(
            tradeLog,
            idTaxByPortfolio,
            ...(idTaxByHolder ?? []),
          ),
          disposals: legs,
          totalProceeds: totalProceeds.toFixed(2),
          totalGain: totalGain.toFixed(2),
          dividendRows,
          dividendTotalsByCurrency,
          byYear,
          indonesianFinalTax: apiIdTax,
        });
      } catch {
        // Best-effort per holder
      }
    }),
  );

  return result;
}

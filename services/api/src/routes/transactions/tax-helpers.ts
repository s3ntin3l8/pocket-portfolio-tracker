import type { FastifyInstance } from "fastify";
import { Decimal } from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import { dividendEvents, instruments, lossCarryforward, portfolios } from "@portfolio/db";
import type {
  CoreTransaction,
  FxRateFn,
  PortfolioSummary,
  IncomeEntry,
  TradeLog,
  IndonesianFinalTax,
  IdCashIncomeSource,
  IdDisposalInput,
  IdIncomeInput,
  IdYearInput,
} from "@portfolio/core";
import {
  cashFlow,
  projectCoupons,
  projectDividends,
  convert,
  toDateKey,
  indonesianFinalTax,
  classifyIdIncome,
  excludeMissingFx,
  defaultPartialExemptionRate,
  idCashBalancesAtPayments,
  idDepositBalanceIdr,
} from "@portfolio/core";
import {
  getFxRates,
  getFxRatesForDates,
  makeFxRateFn,
  recordFxMissing,
  type FxProvider,
} from "../../services/fx.js";
import type { InstrumentMeta } from "../../services/valuation.js";

/** English label of income with no paying instrument, for the ID payload's `symbol`. Keyed by
 *  core's cash income types, so a type added there fails to compile until it has a label. */
const CASH_INCOME_LABEL: Record<IdCashIncomeSource["type"], string> = {
  dividend: "Cash dividend",
  coupon: "Cash coupon",
  interest: "Cash interest",
};

/**
 * German tax amounts the user enters — the Sparerpauschbetrag / Freistellungsauftrag
 * (`accountHolders.taxAllowanceAnnual`, `portfolios.taxAllowanceAnnual`) and the loss
 * carry-forward from the tax certificate — are euro figures by law. The DE trade log they are
 * netted against is in the display (or portfolio base) currency.
 */
export const DE_TAX_AMOUNT_CURRENCY = "EUR";
/** The per-person Sparerpauschbetrag when a holder has none set (single assessment), in EUR. */
export const DE_TAX_ALLOWANCE_DEFAULT_EUR = "1000";

/** Converts a euro tax amount into the trade log's currency. */
export type EurTaxAmountFn = (eur: string) => string;

/**
 * A converter from {@link DE_TAX_AMOUNT_CURRENCY} into `currency` (the DE trade log's
 * currency), or `null` when EUR has no FX rate into it. Never 1:1 (audit B2): a missing rate
 * is recorded in the request's `fxMissingCurrencies` (via `makeFxRateFn`), and the caller
 * treats the euro amounts as unavailable — no allowance, no carry-forward — rather than
 * netting €1,000 as if it were 1,000 of another currency. Uses the request's FX provider, so
 * a read-scoped PAT stays on cached rates.
 */
export async function eurTaxAmountsIn(
  app: FastifyInstance,
  currency: string,
  now: Date = new Date(),
): Promise<EurTaxAmountFn | null> {
  if (currency === DE_TAX_AMOUNT_CURRENCY) return (eur) => eur;
  const rates = await getFxRates(app.db, [DE_TAX_AMOUNT_CURRENCY], currency, now);
  const fx = makeFxRateFn(rates, currency);
  if (fx(DE_TAX_AMOUNT_CURRENCY, currency) === null) return null;
  return (eur) => convert(eur, DE_TAX_AMOUNT_CURRENCY, currency, fx);
}

/** {@link lossCarryForwardFor}'s euro figures in the trade log's currency (none without a rate). */
export function convertLossCarryForward(
  cf: { stock?: string; general?: string } | undefined,
  toLog: EurTaxAmountFn | null,
): { stock?: string; general?: string } | undefined {
  if (!cf) return undefined;
  if (!toLog) return {};
  return {
    ...(cf.stock !== undefined ? { stock: toLog(cf.stock) } : {}),
    ...(cf.general !== undefined ? { general: toLog(cf.general) } : {}),
  };
}

/**
 * The holder's loss carry-forward applies to a single depot's tax view only when the holder has
 * exactly one depot: one certificate figure can't be applied to each of several depots
 * independently (see docs/tax.md). Shared by `/portfolios/:id/tax` and the Sparplan harvest cap
 * so the two can't drift apart.
 */
export function carryForwardAppliesToDepot(holderDepotCount: number): boolean {
  return holderDepotCount <= 1;
}

/**
 * {@link lossCarryForwardFor} for one depot of `holderId`, or `undefined` when it doesn't apply
 * ({@link carryForwardAppliesToDepot}) or nothing was recorded — the depot count is only queried
 * when there is a carry-forward to apply.
 */
export async function depotLossCarryForward(
  app: FastifyInstance,
  userId: string,
  holderId: string,
  taxYear: number,
): Promise<{ stock?: string; general?: string } | undefined> {
  const cf = await lossCarryForwardFor(app, holderId, taxYear);
  if (cf.stock === undefined && cf.general === undefined) return undefined;
  const depots = await app.db
    .select({ id: portfolios.id })
    .from(portfolios)
    .where(and(eq(portfolios.userId, userId), eq(portfolios.accountHolderId, holderId)));
  return carryForwardAppliesToDepot(depots.length) ? cf : undefined;
}

/** Loss carry-forward amounts from the tax certificate, in {@link DE_TAX_AMOUNT_CURRENCY}. */
export async function lossCarryForwardFor(
  app: FastifyInstance,
  holderId: string,
  taxYear: number,
): Promise<{ stock?: string; general?: string }> {
  const rows = await app.db
    .select({ pot: lossCarryforward.pot, amount: lossCarryforward.amount })
    .from(lossCarryforward)
    .where(and(eq(lossCarryforward.holderId, holderId), eq(lossCarryforward.taxYear, taxYear)));
  const result: { stock?: string; general?: string } = {};
  for (const r of rows) {
    if (r.pot === "stock") result.stock = r.amount;
    else if (r.pot === "general") result.general = r.amount;
  }
  return result;
}

/**
 * Compute the gross rest-of-year (today → Dec 31) dividend + coupon income forecast for
 * one portfolio, in `display` currency.  Used by the tax endpoints to feed
 * `forecastIncomeRestOfYear` into `allowanceUsageYTD`.
 *
 * - Projected-from-history dividends are grossed up via each instrument's trailing-12-month
 *   withholding ratio (gross = net + tax, default ratio 1.0 when no withholding recorded).
 * - Announced dividend_events amounts and projected bond coupons are already gross.
 * - Returns "0" when `year` is not the current UTC calendar year.
 */
export async function restOfYearForecastGross(
  app: FastifyInstance,
  coreTxns: CoreTransaction[],
  summary: PortfolioSummary,
  display: string,
  year: number,
  now: Date = new Date(),
): Promise<string> {
  if (year !== now.getUTCFullYear()) return "0";

  const heldIds = summary.holdings.filter((h) => Number(h.quantity) > 0).map((h) => h.instrumentId);
  if (heldIds.length === 0) return "0";

  const heldQtyMap = new Map<string, string>(
    summary.holdings.filter((h) => Number(h.quantity) > 0).map((h) => [h.instrumentId, h.quantity]),
  );

  const qtyAt = (_instrumentId: string, _at: Date): string => heldQtyMap.get(_instrumentId) ?? "0";

  const pastDivEvents: IncomeEntry[] = coreTxns
    .filter((t) => t.type === "dividend" && t.instrumentId)
    .map((t) => ({
      instrumentId: t.instrumentId,
      symbol: null,
      name: null,
      assetClass: null,
      type: t.type,
      price: t.price,
      currency: t.currency,
      executedAt: t.executedAt,
    }));

  const yearAgo = new Date(now);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  // Trailing-12-month net/tax per instrument, as Decimal (audit B12) — they feed a
  // money total returned to the client, so no float sums anywhere in this function.
  const grossUpNet = new Map<string, Decimal>();
  const grossUpTax = new Map<string, Decimal>();
  for (const t of coreTxns) {
    if (t.type !== "dividend" || !t.instrumentId || t.executedAt < yearAgo) continue;
    const net = cashFlow(t);
    const tax = new Decimal(t.tax ?? "0");
    if (net.lte(0)) continue;
    grossUpNet.set(t.instrumentId, (grossUpNet.get(t.instrumentId) ?? new Decimal(0)).add(net));
    grossUpTax.set(t.instrumentId, (grossUpTax.get(t.instrumentId) ?? new Decimal(0)).add(tax));
  }

  const projectedDivs = projectDividends(pastDivEvents, heldQtyMap, qtyAt, now);

  const todayStr = toDateKey(now);
  const yearEndStr = toDateKey(new Date(Date.UTC(now.getUTCFullYear(), 11, 31)));

  const announcedRows =
    heldIds.length > 0
      ? await app.db
          .select()
          .from(dividendEvents)
          .where(inArray(dividendEvents.instrumentId, heldIds))
      : [];

  const futureByInstrument = new Map<
    string,
    { exDate: string; amount: string; currency: string }[]
  >();
  for (const row of announcedRows) {
    const qty = heldQtyMap.get(row.instrumentId);
    if (!qty) continue;
    const totalAmount = new Decimal(row.amountPerShare).mul(qty).toString();
    const list = futureByInstrument.get(row.instrumentId) ?? [];
    list.push({ exDate: row.exDate, amount: totalAmount, currency: row.currency });
    futureByInstrument.set(row.instrumentId, list);
  }

  const instrumentsWithAnnounced = new Set(
    [...futureByInstrument.entries()]
      .filter(([_, rows]) => rows.some((r) => r.exDate > todayStr && r.exDate <= yearEndStr))
      .map(([id]) => id),
  );
  const blendedProjected = projectedDivs.filter(
    (d) => d.instrumentId && !instrumentsWithAnnounced.has(d.instrumentId!),
  );
  const announcedRestOfYear = [...futureByInstrument.values()]
    .flat()
    .filter((d) => d.exDate > todayStr && d.exDate <= yearEndStr);

  const bondRows =
    heldIds.length > 0
      ? await app.db
          .select()
          .from(instruments)
          .where(and(inArray(instruments.id, heldIds), eq(instruments.assetClass, "bond")))
      : [];
  const qtyById = new Map(summary.holdings.map((h) => [h.instrumentId, h.quantity]));
  const bondPositions = bondRows
    .filter((b) => b.faceValue && b.couponRate && b.maturityDate)
    .map((b) => ({
      instrumentId: b.id,
      symbol: b.symbol,
      name: b.name,
      quantity: qtyById.get(b.id) ?? "0",
      faceValue: b.faceValue as string,
      couponRate: b.couponRate as string,
      couponSchedule: b.couponSchedule,
      maturityDate: b.maturityDate as string,
      currency: b.currency,
    }));
  const yearEnd = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
  const restOfYearCoupons = projectCoupons(bondPositions, yearEnd, now).filter(
    (c) => c.date > todayStr,
  );

  const allCcys = new Set<string>([
    ...blendedProjected.map((d) => d.currency),
    ...announcedRestOfYear.map((d) => d.currency),
    ...restOfYearCoupons.map((c) => c.currency),
  ]);
  if (allCcys.size === 0) return "0";

  const rates = await getFxRates(app.db, [...allCcys], display);
  // A projection is a pure sum: unconvertible amounts are excluded (audit B2) and
  // reported via the request's fxMissingCurrencies.
  const fx = excludeMissingFx(makeFxRateFn(rates, display));

  let totalGross = new Decimal(0);

  for (const d of blendedProjected) {
    const net = new Decimal(convert(d.amount, d.currency, display, fx));
    const instrumentId = d.instrumentId!;
    const netSum = grossUpNet.get(instrumentId) ?? new Decimal(0);
    const taxSum = grossUpTax.get(instrumentId) ?? new Decimal(0);
    // gross = net × (net + tax) / net — multiply before dividing so a ratio like 1/3 isn't
    // rounded first. No withholding recorded → ratio 1.
    totalGross = totalGross.add(netSum.gt(0) ? net.mul(netSum.add(taxSum)).div(netSum) : net);
  }

  for (const d of announcedRestOfYear) {
    totalGross = totalGross.add(convert(d.amount, d.currency, display, fx));
  }

  for (const c of restOfYearCoupons) {
    totalGross = totalGross.add(convert(c.amount, c.currency, display, fx));
  }

  return totalGross.gt(0) ? totalGross.toFixed(2) : "0";
}

export function buildTfRates(
  trades: { instrumentId: string }[],
  metaById: Map<string, InstrumentMeta>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const t of trades) {
    const meta = metaById.get(t.instrumentId);
    if (!meta) continue;
    const rate = meta.partialExemptionRate ?? defaultPartialExemptionRate(meta.assetClass);
    if (rate !== null) result[t.instrumentId] = rate;
  }
  return result;
}

/** One portfolio's income transactions and its country, the unit cash interest is judged by. */
export interface IdIncomeSource {
  coreTxns: CoreTransaction[];
  /** The portfolio's country (ISO 3166-1 alpha-2); null when unset. */
  portfolioCountry: string | null;
}

/** Bank interest is cash interest (no paying instrument) that classifies as Indonesian. */
function isIdBankInterest(t: CoreTransaction, portfolioCountry: string | null): boolean {
  return (
    t.type === "interest" &&
    !t.instrumentId &&
    classifyIdIncome({ type: t.type, currency: t.currency, instrument: null, portfolioCountry }) ===
      "deposit_interest"
  );
}

/** FX into IDR as of a payment's date, for the Rp7.5M balance test. */
export type IdDepositFxAt = (at: Date) => FxRateFn;

/**
 * FX into IDR for every Indonesian bank-interest payment of `sources`, by payment date: what
 * the Rp7.5M exemption (PMK 212/2018 Art. 7(a)) converts the paying portfolio's cash with
 * (every currency of it, at the payment date's rate). ONE `getFxRatesForDates` load over the
 * union of currencies and payment dates of `sources`, whatever the number of portfolios —
 * per call, so `/networth/tax`, which calls it once per account holder, loads once per holder
 * (each holder's own sets; a later holder's overlap is served from the rates just cached).
 * {@link computeIndonesianFinalTaxFromTradeLog} then takes each payment's balance from its
 * own portfolio's transactions (`idCashBalancesAtPayments`) — one portfolio stands for one bank,
 * an approximation, since the rule is per bank and Pocket doesn't know which portfolios share
 * one. A currency with no IDR rate makes that balance unknown (taxed at 20%) and is reported
 * in the request's `fxMissingCurrencies`.
 *
 * `fxProvider` follows the history routes: `null` for a read-scoped PAT (cached rates only,
 * audit A7), `undefined` for the request default.
 */
export async function loadIdDepositFx(
  app: FastifyInstance,
  sources: IdIncomeSource[],
  fxProvider?: FxProvider | null,
): Promise<IdDepositFxAt> {
  const currencies = new Set<string>();
  const dates = new Set<string>();
  for (const { coreTxns, portfolioCountry } of sources) {
    const payments = coreTxns.filter((t) => isIdBankInterest(t, portfolioCountry));
    if (payments.length === 0) continue;
    for (const t of coreTxns) currencies.add(t.currency);
    for (const t of payments) dates.add(toDateKey(t.executedAt));
  }
  const ratesByDate =
    dates.size === 0
      ? new Map<string, Record<string, string>>()
      : await getFxRatesForDates(app.db, [...currencies], "IDR", [...dates], fxProvider);
  return (at) => makeFxRateFn(ratesByDate.get(toDateKey(at)) ?? {}, "IDR");
}

/**
 * Build the Indonesian final-tax payload from a (single) portfolio's trade log + raw core
 * transactions. Mirrors the web tier's per-holder assembly in `loadTaxYearDetail` so the
 * API and the (replaced) client side agree to the decimal — single source of truth.
 *
 * - Disposals for `year` are grouped by (instrumentId, sellDate) so each disposal row is
 *   one economic sale day, with proceeds / quantity / avg-buy / sell-price.
 * - Every dividend/coupon/interest transaction becomes one income row with gross = net +
 *   recorded withholding (`cashFlow` computes net = qty × price − fees for income rows) and
 *   a category from `classifyIdIncome` (domestic dividend, bond interest, bank interest,
 *   reksa dana distribution, or foreign income) — each category has its own rate. Income
 *   without an instrument is classified by the country of the portfolio it was booked in,
 *   so the transactions come grouped per portfolio (`incomeSources`). Indonesian bank
 *   interest is exempt when its portfolio's balance before the payment was at most
 *   Rp7.5M (converted with `depositFxAt`, from {@link loadIdDepositFx}).
 * - `byYear` rolls proceeds and income across every year so prior tax years still get a
 *   real Est. tax figure under ID.
 */
export function computeIndonesianFinalTaxFromTradeLog(input: {
  tradeLog: TradeLog;
  /** Each portfolio's transactions with that portfolio's country (null when unset). */
  incomeSources: IdIncomeSource[];
  /** {@link loadIdDepositFx} of the same sources: converts each bank-interest payment's
   *  portfolio balance to IDR for the Rp7.5M exemption. Without it every payment is taxed
   *  at the full 20%. */
  depositFxAt?: IdDepositFxAt;
  year: number;
  metaById: Map<string, InstrumentMeta>;
  /** User's display currency. Dividends are converted from their native currency to
   *  this before being summed — otherwise a EUR depot + IDR user would sum EUR figures
   *  and label them IDR (the response's `currency` field). */
  displayCurrency: string;
  /** Native-currency → displayCurrency conversion rates, keyed by the native currency.
   *  Obtained from `getFxRates(app.db, ccys, display)` in the calling route. */
  fxRates: Map<string, number>;
}): IndonesianFinalTax {
  const { tradeLog, incomeSources, year, metaById, displayCurrency, fxRates } = input;
  const ZERO = "0";

  // Native-currency → display-currency. A source currency with no registered rate is
  // excluded (0) and reported via the request's fxMissingCurrencies (audit B2) — never
  // counted 1:1, and never a failed report.
  const fxTo = (amount: Decimal, fromCurrency: string): Decimal => {
    if (fromCurrency === displayCurrency) return amount;
    const rate = fxRates.get(fromCurrency);
    if (rate === undefined) {
      recordFxMissing([fromCurrency]);
      return new Decimal(0);
    }
    return amount.mul(rate);
  };

  // The 0.1% final sales tax only covers disposals of IDX-listed shares; gold, crypto,
  // foreign-listed ETFs/stocks and bonds are out of scope (audit C4). Unknown instruments
  // (no metadata) are excluded rather than guessed.
  const salesTaxApplies = (instrumentId: string): boolean => {
    const meta = metaById.get(instrumentId);
    return meta?.market === "IDX" && meta.assetClass === "equity";
  };

  // Disposals for the selected year, grouped per (instrumentId, sellDate).
  type DisposalGroup = {
    instrumentId: string;
    symbol: string;
    when: string;
    proceeds: Decimal;
    quantity: Decimal;
    cost: Decimal;
  };
  const disposalGroups = new Map<string, DisposalGroup>();
  for (const t of tradeLog.trades) {
    if (!salesTaxApplies(t.instrumentId)) continue;
    for (const l of t.legs) {
      if (l.taxYear !== year) continue;
      const key = `${t.instrumentId}:${l.sellDate}`;
      const qty = new Decimal(l.quantity);
      const proceeds = new Decimal(l.proceeds);
      const cost = new Decimal(l.cost);
      const existing = disposalGroups.get(key);
      const symbol = metaById.get(t.instrumentId)?.symbol ?? t.instrumentId.slice(0, 8);
      if (existing) {
        existing.proceeds = existing.proceeds.add(proceeds);
        existing.quantity = existing.quantity.add(qty);
        existing.cost = existing.cost.add(cost);
      } else {
        disposalGroups.set(key, {
          instrumentId: t.instrumentId,
          symbol,
          when: l.sellDate,
          proceeds,
          quantity: qty,
          cost,
        });
      }
    }
  }
  const disposals: IdDisposalInput[] = [...disposalGroups.values()].map((g) => ({
    symbol: g.symbol,
    when: g.when,
    instrumentId: g.instrumentId,
    proceeds: g.proceeds.toFixed(2),
    quantity: g.quantity.gt(0) ? g.quantity.toString() : ZERO,
    avgBuyPrice: g.quantity.gt(0) ? g.cost.div(g.quantity).toFixed(2) : ZERO,
    sellPrice: g.quantity.gt(0) ? g.proceeds.div(g.quantity).toFixed(2) : ZERO,
  }));

  // Income (dividend / coupon / interest) of EVERY year, one row per transaction: the core
  // decides each row's rate from its category (and the recorded withholding), then groups the
  // selected year's rows for display and rolls all years up for `byYear`.
  const income: IdIncomeInput[] = [];
  for (const { coreTxns, portfolioCountry } of incomeSources) {
    // Each bank-interest payment's balance, from this portfolio's own ledger in one walk
    // (keyed by the rows iterated just below, so nothing can re-map them in between).
    const balancesAt = input.depositFxAt
      ? idCashBalancesAtPayments(
          coreTxns,
          coreTxns.filter((t) => isIdBankInterest(t, portfolioCountry)),
        )
      : null;
    for (const t of coreTxns) {
      if (t.type !== "dividend" && t.type !== "coupon" && t.type !== "interest") continue;
      const instrumentId = t.instrumentId ?? null;
      const meta = instrumentId ? metaById.get(instrumentId) : undefined;
      const category = classifyIdIncome({
        type: t.type,
        currency: t.currency,
        instrument: instrumentId
          ? // An instrument with no metadata row can't be shown to be Indonesian: foreign.
            (meta ?? { market: "", assetClass: "", isin: null })
          : null,
        portfolioCountry,
      });
      // cashFlow computes net = (qty>0 ? qty*price : price) − fees for income rows; gross is
      // net + the withholding recorded on the row. Both are converted to the display currency
      // so the sums don't mix native-currency figures under the response's display label.
      const net = fxTo(new Decimal(cashFlow(t).toString()), t.currency);
      const recordedTax = fxTo(new Decimal(t.tax ?? "0"), t.currency);
      // Cash income (no instrument) carries its type and own currency; its `symbol` is a
      // readable English label for API/MCP consumers (the web localises from `cashSource`),
      // never the bare type key ("interest").
      const cashSource = instrumentId ? null : { type: t.type, currency: t.currency.toUpperCase() };
      income.push({
        instrumentId,
        symbol: instrumentId
          ? (meta?.symbol ?? instrumentId.slice(0, 8))
          : `${CASH_INCOME_LABEL[t.type]} · ${t.currency.toUpperCase()}`,
        ...(cashSource ? { cashSource } : {}),
        currency: displayCurrency,
        category,
        year: t.executedAt.getUTCFullYear(),
        gross: net.add(recordedTax).toFixed(2),
        recordedTax: recordedTax.toFixed(2),
        // Bank interest: its portfolio's whole cash balance in IDR when it was credited,
        // which decides the Rp7.5M exemption (one portfolio = one bank).
        ...(input.depositFxAt && balancesAt?.has(t)
          ? {
              depositBalanceIdr: idDepositBalanceIdr(
                balancesAt.get(t) ?? null,
                input.depositFxAt(t.executedAt),
              ),
            }
          : {}),
      });
    }
  }

  // Per-year proceeds from the trade log legs (across ALL years, for the byYear table).
  // TradeLog itself is already in display currency (built via `mergeTradeLogs(logs, display)`),
  // so byYear rows stay in display currency end-to-end — no FX pass needed here.
  const proceedsByYearMap = new Map<number, Decimal>();
  for (const t of tradeLog.trades) {
    if (!salesTaxApplies(t.instrumentId)) continue;
    for (const l of t.legs) {
      const prev = proceedsByYearMap.get(l.taxYear) ?? new Decimal(0);
      proceedsByYearMap.set(l.taxYear, prev.add(l.proceeds));
    }
  }
  const allYears = new Set<number>([
    ...proceedsByYearMap.keys(),
    ...tradeLog.realizedByYear.map((r) => r.year),
  ]);
  const byYear: IdYearInput[] = [...allYears].map((y) => ({
    year: y,
    proceeds: (proceedsByYearMap.get(y) ?? new Decimal(0)).toFixed(2),
    realized: tradeLog.realizedByYear.find((r) => r.year === y)?.amount ?? "0",
  }));

  return indonesianFinalTax({ year, disposals, income, byYear });
}

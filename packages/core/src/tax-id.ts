/**
 * Indonesian final-tax helpers for a resident individual: the flat tax on listed-share
 * sale proceeds plus a final tax on investment income whose rate depends on the TYPE and
 * SOURCE of the income.
 *
 * Scope (sources: docs/tax.md › "Indonesian final-tax regime"):
 *   - Sales tax: 0.1% of gross sale PROCEEDS (not gain) for disposals of IDX-listed shares
 *     (the caller filters disposals to `market === "IDX" && assetClass === "equity"`),
 *     withheld by the exchange through the broker. PP 41/1994 as amended by PP 14/1997;
 *     KMK 282/KMK.04/1997.
 *   - Investment income, classified per transaction by {@link classifyIdIncome}:
 *       domestic_dividend  10% final of gross, paid by the investor by the 15th of the
 *                          following month (nothing is withheld for a resident individual);
 *                          EXEMPT if reinvested in Indonesia for at least 3 tax years.
 *                          UU PPh Art. 4(3)(f) and 17(2c) as amended by UU HPP 7/2021;
 *                          PMK 18/PMK.03/2021; PMK 81/2024 Art. 370–374.
 *       bond_interest      10% final of gross interest for the holding period (government
 *                          bonds and SBN retail included), withheld by the issuer or
 *                          custodian. PP 91/2021 Art. 2, from 30 Aug 2021 (15% before).
 *       deposit_interest   20% final of gross interest on deposits, savings and current
 *                          accounts, withheld by the bank. PP 131/2000 as amended by
 *                          PP 123/2015; PMK 212/PMK.03/2018. Exempt when the deposit and
 *                          savings balance is ≤ Rp7,500,000 (PMK 212 Art. 7(a)) — not applied
 *                          here, see docs/tax.md.
 *       fund_distribution  0%: profit distributed by a collective investment contract
 *                          (reksa dana, IDX ETF, DIRE) is not an income-tax object for the
 *                          unit holder. UU PPh Art. 4(3)(i).
 *       foreign            Foreign-source income is outside these final regimes: it is
 *                          ordinary income at the progressive Art. 17 rates (5–35%) with a
 *                          foreign tax credit (UU PPh Art. 24, PMK 192/PMK.03/2018), or
 *                          exempt to the extent it is reinvested in Indonesia (PMK 18/2021).
 *                          Pocket can't know the marginal rate, so it is reported
 *                          separately and kept out of the estimate.
 *   - For the two categories withheld at source (bond and deposit interest), a withholding
 *     recorded on the transaction is the tax figure; the statutory rate is only applied
 *     when none is recorded. A domestic dividend is always `gross × 10%` (nothing is
 *     withheld for a resident individual, so a recorded tax there is not Indonesian tax).
 *   - No annual allowance, no tax-loss harvesting, no realized-gain-based computation
 *     (unlike the German path in `tax.ts`).
 *
 * This is an estimate, not tax advice. All money amounts are Decimal strings (never
 * floats) in, and out.
 */

import { Decimal } from "decimal.js";
import { D } from "./decimal.js";

/** 0.1% of gross proceeds of IDX-listed shares (PP 41/1994 as amended by PP 14/1997). */
export const ID_SALES_TAX_RATE = "0.001";
/** Domestic dividends, resident individual: 10% final unless reinvested ≥3 years
 *  (UU PPh Art. 17(2c), 4(3)(f)). */
export const ID_DOMESTIC_DIVIDEND_TAX_RATE = "0.10";
/** Bond interest/coupons, resident individual: 10% final (PP 91/2021). */
export const ID_BOND_INTEREST_TAX_RATE = "0.10";
/** Bank deposit, savings and current-account interest: 20% final (PP 131/2000,
 *  PMK 212/PMK.03/2018). */
export const ID_DEPOSIT_INTEREST_TAX_RATE = "0.20";
/** Reksa dana / ETF distributions to the unit holder: not a tax object (UU PPh 4(3)(i)). */
export const ID_FUND_DISTRIBUTION_TAX_RATE = "0";
/** Deposit + savings balance at or below which no tax is due (PMK 212/2018 Art. 7(a)).
 *  Informational: Pocket does not apply it (it can't see the balance at the bank). */
export const ID_DEPOSIT_EXEMPT_BALANCE_IDR = "7500000";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One FIFO buy-lot consumed by a disposal — carried through for an expandable
 *  per-lot detail view on the disposals table (see `IdDisposalInput.lots`). */
export interface IdDisposalLot {
  acqDate: string; // YYYY-MM-DD
  quantity: string;
  buyPrice: string; // this lot's cost per share
  sellPrice: string; // this lot's proceeds per share
  proceeds: string;
  gain: string; // informational only under ID's proceeds-based final tax
  holdingDays: number;
  longTerm: boolean;
}

export interface IdDisposalInput {
  symbol: string;
  when: string; // YYYY-MM-DD
  proceeds: string;
  /** The underlying instrument's stable id. Optional for backward compatibility (older
   *  callers that don't pass it fall back to `symbol` for row identity in the UI). The
   *  web tier uses it to disambiguate rows that share a displayed `symbol` but are
   *  different instruments — e.g. dual-listed tickers or the `instrumentId.slice(0, 8)`
   *  fallback for unnamed instruments colliding with a real symbol. */
  instrumentId?: string | null;
  /** Aggregate quantity/price fields + the individual consumed lots — all optional,
   *  pure pass-through (not used in the 0.1% tax computation below, which only needs
   *  `proceeds`). Populated by the web tier when a disposal spans multiple FIFO lots
   *  (e.g. an ETF bought in several tranches, sold in one order) so the UI can show an
   *  aggregate "avg buy → sell" row with a collapsible per-lot breakdown. */
  quantity?: string;
  avgBuyPrice?: string;
  sellPrice?: string;
  lots?: IdDisposalLot[];
}

export interface IdDisposalTax extends IdDisposalInput {
  /** proceeds × 0.1%, decimal string. */
  tax: string;
}

/** How a row of investment income is taxed for an Indonesian resident individual. */
export type IdIncomeCategory =
  "domestic_dividend" | "bond_interest" | "deposit_interest" | "fund_distribution" | "foreign";

/** Display order of the categories (the UI and the rollup follow it). */
export const ID_INCOME_CATEGORIES: readonly IdIncomeCategory[] = [
  "domestic_dividend",
  "bond_interest",
  "deposit_interest",
  "fund_distribution",
  "foreign",
];

/** The final-tax rate of a category; `null` for foreign income (marginal rate, unknown). */
export function idIncomeTaxRate(category: IdIncomeCategory): string | null {
  switch (category) {
    case "domestic_dividend":
      return ID_DOMESTIC_DIVIDEND_TAX_RATE;
    case "bond_interest":
      return ID_BOND_INTEREST_TAX_RATE;
    case "deposit_interest":
      return ID_DEPOSIT_INTEREST_TAX_RATE;
    case "fund_distribution":
      return ID_FUND_DISTRIBUTION_TAX_RATE;
    case "foreign":
      return null;
  }
}

/** Whether the payer withholds the category's final tax (so it is not tax still to pay). */
export function idIncomeWithheldAtSource(category: IdIncomeCategory): boolean {
  return category === "bond_interest" || category === "deposit_interest";
}

/** What {@link classifyIdIncome} needs to know about one income transaction. */
export interface IdIncomeClassifyInput {
  type: "dividend" | "coupon" | "interest";
  /** The transaction's currency. */
  currency: string;
  /** The paying instrument, or null for cash interest (a bank or broker cash balance). */
  instrument?: {
    market: string;
    assetClass: string;
    isin?: string | null;
  } | null;
  /** The country (ISO 3166-1 alpha-2) of the portfolio the transaction belongs to — where
   *  the account is held. Decides income without an instrument; null/empty when unset. */
  portfolioCountry?: string | null;
}

/**
 * Decide how an income transaction is taxed.
 *
 * "Domestic" (Indonesian-source) is decided by the paying instrument, never by the
 * transaction currency: an instrument is domestic when it is on the IDX market (the same
 * predicate the 0.1% sales tax uses; Indonesian government retail bonds are booked there
 * too) or its ISIN carries Indonesia's country prefix `ID`. Cash interest has no
 * instrument, so it is decided by the portfolio's country (where the account is held):
 * `ID` is an Indonesian bank, 20% final in any currency (a USD deposit at an Indonesian
 * bank included, PMK 212/2018); any other country is foreign income in any currency. With
 * no country set, the currency is the fallback: IDR interest is treated as Indonesian,
 * interest in any other currency as foreign (docs/tax.md).
 */
export function classifyIdIncome(input: IdIncomeClassifyInput): IdIncomeCategory {
  const inst = input.instrument ?? null;
  const country = input.portfolioCountry?.trim().toUpperCase() || null;
  const domestic = inst
    ? inst.market.toUpperCase() === "IDX" || /^ID/i.test(inst.isin ?? "")
    : country !== null
      ? country === "ID"
      : input.currency.toUpperCase() === "IDR";
  if (!domestic) return "foreign";
  if (inst && (inst.assetClass === "mutual_fund" || inst.assetClass === "etf")) {
    return "fund_distribution";
  }
  if (input.type === "coupon" || inst?.assetClass === "bond") return "bond_interest";
  if (input.type === "dividend") return "domestic_dividend";
  return "deposit_interest";
}

/** Income with no paying instrument (interest on a bank or broker cash balance): what it
 *  was and the currency it was paid in. The report's `currency` is the display currency,
 *  so this is the only place a cash row's own currency survives — the UI labels the row
 *  with it ("Cash interest · EUR") instead of an internal type key. */
export interface IdCashIncomeSource {
  type: "dividend" | "coupon" | "interest";
  /** The transaction's own currency (ISO 4217). */
  currency: string;
}

/** One income transaction, already in the report's currency. */
export interface IdIncomeInput {
  /** The paying instrument's id; rows are grouped per (instrument or cash source, category). */
  instrumentId?: string | null;
  symbol: string;
  /** Set when there is no paying instrument; cash rows are grouped per type and currency. */
  cashSource?: IdCashIncomeSource | null;
  /** The report currency the amounts are in. */
  currency: string;
  category: IdIncomeCategory;
  /** Tax year (calendar year of the payment). */
  year: number;
  /** Gross amount: net received + any withholding recorded on the transaction. */
  gross: string;
  /** Withholding recorded on the transaction ("0" when none). */
  recordedTax: string;
}

/** Where a row's tax figure comes from. */
export type IdIncomeTaxBasis = "recorded" | "estimated" | "mixed";

export interface IdIncomeTax {
  instrumentId?: string | null;
  symbol: string;
  /** Cash income only (no paying instrument): its type and own currency. */
  cashSource?: IdCashIncomeSource | null;
  currency: string;
  category: IdIncomeCategory;
  /** The category's final rate; null for foreign income. */
  rate: string | null;
  gross: string;
  /** Indonesian final tax; null for foreign income (not part of the estimate). */
  tax: string | null;
  /** gross − tax; null for foreign income. */
  net: string | null;
  /** True when the payer withholds this tax (bond and deposit interest). */
  withheldAtSource: boolean;
  /** Whether `tax` is the recorded withholding, the rate applied, or both across rows;
   *  null for foreign income and for the 0% fund distributions. */
  taxBasis: IdIncomeTaxBasis | null;
  /** Foreign income only: the foreign tax recorded as withheld (creditable). */
  foreignTaxWithheld: string | null;
}

export interface IdIncomeCategoryTotal {
  category: IdIncomeCategory;
  rate: string | null;
  gross: string;
  /** null for foreign income. */
  tax: string | null;
  withheldAtSource: boolean;
}

export interface IdYearInput {
  year: number;
  /** Sum of sale proceeds of in-scope disposals closed in this tax year. */
  proceeds: string;
  /** Realized gain for this tax year — informational only, not taxed under ID. */
  realized: string;
}

/**
 * One tax year's totals for the "By year" table. `realized` (gain) is informational
 * only — Indonesian final tax is never levied on gains, only on proceeds/gross.
 */
export interface IdYearTax {
  year: number;
  realized: string;
  /** Gross Indonesian investment income (every category except foreign). */
  income: string;
  /** Gross foreign-source income (not in `tax`). */
  foreignIncome: string;
  /** Sales tax + final tax on the Indonesian income. */
  tax: string;
}

export interface IndonesianFinalTaxInput {
  /** The selected tax year. */
  year: number;
  /** Disposals for the selected tax year. */
  disposals: IdDisposalInput[];
  /** Income transactions of EVERY year (the selected year's rows feed the detail, all of
   *  them feed `byYear`). */
  income: IdIncomeInput[];
  /** Per-year proceeds and realized gain across every year the trade log covers. */
  byYear: IdYearInput[];
}

export interface IndonesianFinalTax {
  disposals: IdDisposalTax[];
  totalProceeds: string;
  totalSalesTax: string;
  /** The selected year's income, grouped per (instrument, category), every category. */
  income: IdIncomeTax[];
  /** The selected year's income per category, in {@link ID_INCOME_CATEGORIES} order;
   *  categories with no income are omitted. */
  incomeByCategory: IdIncomeCategoryTotal[];
  /** Gross Indonesian investment income (foreign excluded). */
  totalIncomeGross: string;
  /** Final tax on the Indonesian investment income. */
  totalIncomeTax: string;
  totalIncomeNet: string;
  /** Gross foreign-source income — taxed at the marginal rate, not in `estimatedTax`. */
  foreignIncomeGross: string;
  /** Foreign tax recorded as withheld on that income (creditable). */
  foreignTaxWithheld: string;
  /** totalSalesTax + totalIncomeTax — the hero-card headline figure. */
  estimatedTax: string;
  /** The part of `estimatedTax` the payer withholds (sales, bond and deposit interest). */
  taxWithheldAtSource: string;
  /** The part the investor pays (domestic dividends, unless reinvested). */
  taxToSelfPay: string;
  /** Sorted newest year first. */
  byYear: IdYearTax[];
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const ZERO = new Decimal(0);

/** The Indonesian final tax on one income row, or null for foreign income. */
function incomeRowTax(
  r: IdIncomeInput,
): { tax: Decimal; basis: "recorded" | "estimated" | null } | null {
  const rate = idIncomeTaxRate(r.category);
  if (rate === null) return null;
  const recorded = D(r.recordedTax);
  if (idIncomeWithheldAtSource(r.category) && recorded.gt(0)) {
    return { tax: recorded, basis: "recorded" };
  }
  const tax = D(r.gross).times(rate);
  return { tax, basis: tax.isZero() && D(rate).isZero() ? null : "estimated" };
}

type IncomeAcc = {
  instrumentId?: string | null;
  symbol: string;
  cashSource?: IdCashIncomeSource | null;
  currency: string;
  category: IdIncomeCategory;
  gross: Decimal;
  tax: Decimal;
  recorded: Decimal;
  bases: Set<"recorded" | "estimated">;
};

function finishIncomeRow(a: IncomeAcc): IdIncomeTax {
  const foreign = a.category === "foreign";
  const basis: IdIncomeTaxBasis | null =
    a.bases.size === 0 ? null : a.bases.size > 1 ? "mixed" : [...a.bases][0]!;
  return {
    ...(a.instrumentId !== undefined ? { instrumentId: a.instrumentId } : {}),
    symbol: a.symbol,
    ...(a.cashSource ? { cashSource: a.cashSource } : {}),
    currency: a.currency,
    category: a.category,
    rate: idIncomeTaxRate(a.category),
    gross: a.gross.toFixed(2),
    tax: foreign ? null : a.tax.toFixed(2),
    net: foreign ? null : a.gross.minus(a.tax).toFixed(2),
    withheldAtSource: idIncomeWithheldAtSource(a.category),
    taxBasis: foreign ? null : basis,
    foreignTaxWithheld: foreign ? a.recorded.toFixed(2) : null,
  };
}

function categoryTotals(rows: IdIncomeTax[]): IdIncomeCategoryTotal[] {
  const out: IdIncomeCategoryTotal[] = [];
  for (const category of ID_INCOME_CATEGORIES) {
    const of = rows.filter((r) => r.category === category);
    if (of.length === 0) continue;
    const gross = of.reduce((s, r) => s.plus(r.gross), ZERO);
    const tax = category === "foreign" ? null : of.reduce((s, r) => s.plus(r.tax ?? "0"), ZERO);
    out.push({
      category,
      rate: idIncomeTaxRate(category),
      gross: gross.toFixed(2),
      tax: tax === null ? null : tax.toFixed(2),
      withheldAtSource: idIncomeWithheldAtSource(category),
    });
  }
  return out;
}

/** Totals derived from the per-row figures (shared with {@link mergeIndonesianFinalTax}). */
function incomeTotals(
  rows: IdIncomeTax[],
  totalSalesTax: Decimal,
): Pick<
  IndonesianFinalTax,
  | "incomeByCategory"
  | "totalIncomeGross"
  | "totalIncomeTax"
  | "totalIncomeNet"
  | "foreignIncomeGross"
  | "foreignTaxWithheld"
  | "estimatedTax"
  | "taxWithheldAtSource"
  | "taxToSelfPay"
> {
  let gross = ZERO;
  let tax = ZERO;
  let withheld = ZERO;
  let selfPay = ZERO;
  let foreignGross = ZERO;
  let foreignWht = ZERO;
  for (const r of rows) {
    if (r.category === "foreign") {
      foreignGross = foreignGross.plus(r.gross);
      foreignWht = foreignWht.plus(r.foreignTaxWithheld ?? "0");
      continue;
    }
    gross = gross.plus(r.gross);
    tax = tax.plus(r.tax ?? "0");
    if (r.withheldAtSource) withheld = withheld.plus(r.tax ?? "0");
    else selfPay = selfPay.plus(r.tax ?? "0");
  }
  return {
    incomeByCategory: categoryTotals(rows),
    totalIncomeGross: gross.toFixed(2),
    totalIncomeTax: tax.toFixed(2),
    totalIncomeNet: gross.minus(tax).toFixed(2),
    foreignIncomeGross: foreignGross.toFixed(2),
    foreignTaxWithheld: foreignWht.toFixed(2),
    estimatedTax: totalSalesTax.plus(tax).toFixed(2),
    taxWithheldAtSource: totalSalesTax.plus(withheld).toFixed(2),
    taxToSelfPay: selfPay.toFixed(2),
  };
}

/**
 * Compute Indonesian final tax for the selected year's disposals and income, plus a
 * per-year rollup across every year the inputs cover. Prior years apply today's rates
 * (the 15% → 10% bond-interest change of 30 Aug 2021 is not replayed), unless a
 * withholding is recorded on the transaction.
 */
export function indonesianFinalTax(input: IndonesianFinalTaxInput): IndonesianFinalTax {
  const salesRate = D(ID_SALES_TAX_RATE);

  let totalProceeds = ZERO;
  let totalSalesTax = ZERO;
  const disposals: IdDisposalTax[] = input.disposals.map((r) => {
    const proceeds = D(r.proceeds);
    const tax = proceeds.times(salesRate);
    totalProceeds = totalProceeds.plus(proceeds);
    totalSalesTax = totalSalesTax.plus(tax);
    return { ...r, tax: tax.toFixed(2) };
  });

  // Tax is decided per transaction (recorded vs. estimated), then grouped for display.
  const groups = new Map<string, IncomeAcc>();
  const incomeByYear = new Map<number, { income: Decimal; foreign: Decimal; tax: Decimal }>();
  for (const r of input.income) {
    const rowTax = incomeRowTax(r);
    const y = incomeByYear.get(r.year) ?? { income: ZERO, foreign: ZERO, tax: ZERO };
    if (rowTax === null) {
      y.foreign = y.foreign.plus(r.gross);
    } else {
      y.income = y.income.plus(r.gross);
      y.tax = y.tax.plus(rowTax.tax);
    }
    incomeByYear.set(r.year, y);
    if (r.year !== input.year) continue;

    // Cash rows group per type and own currency: EUR and USD interest stay two rows even
    // though both are reported in the display currency.
    const source = r.instrumentId
      ? r.instrumentId
      : r.cashSource
        ? `cash:${r.cashSource.type}:${r.cashSource.currency}`
        : r.symbol;
    const key = `${source}:${r.currency}:${r.category}`;
    const acc = groups.get(key) ?? {
      ...(r.instrumentId !== undefined ? { instrumentId: r.instrumentId } : {}),
      symbol: r.symbol,
      ...(r.cashSource ? { cashSource: r.cashSource } : {}),
      currency: r.currency,
      category: r.category,
      gross: ZERO,
      tax: ZERO,
      recorded: ZERO,
      bases: new Set<"recorded" | "estimated">(),
    };
    acc.gross = acc.gross.plus(r.gross);
    acc.recorded = acc.recorded.plus(r.recordedTax);
    if (rowTax) {
      acc.tax = acc.tax.plus(rowTax.tax);
      if (rowTax.basis) acc.bases.add(rowTax.basis);
    }
    groups.set(key, acc);
  }
  const income = [...groups.values()].map(finishIncomeRow);

  const years = new Set<number>([...input.byYear.map((y) => y.year), ...incomeByYear.keys()]);
  const byYear: IdYearTax[] = [...years]
    .sort((a, b) => b - a)
    .map((year) => {
      const t = input.byYear.find((y) => y.year === year);
      const inc = incomeByYear.get(year) ?? { income: ZERO, foreign: ZERO, tax: ZERO };
      const salesTax = D(t?.proceeds ?? "0").times(salesRate);
      return {
        year,
        realized: D(t?.realized ?? "0").toFixed(2),
        income: inc.income.toFixed(2),
        foreignIncome: inc.foreign.toFixed(2),
        tax: salesTax.plus(inc.tax).toFixed(2),
      };
    });

  return {
    disposals,
    totalProceeds: totalProceeds.toFixed(2),
    totalSalesTax: totalSalesTax.toFixed(2),
    income,
    ...incomeTotals(income, totalSalesTax),
    byYear,
  };
}

/**
 * Combine several {@link IndonesianFinalTax} results that share one currency (e.g. one per
 * account holder) into a single payload: rows are concatenated, totals re-derived from
 * them, and the by-year rows summed per year.
 */
export function mergeIndonesianFinalTax(parts: IndonesianFinalTax[]): IndonesianFinalTax {
  const disposals = parts.flatMap((p) => p.disposals);
  const income = parts.flatMap((p) => p.income);
  const totalProceeds = parts.reduce((s, p) => s.plus(p.totalProceeds), ZERO);
  const totalSalesTax = parts.reduce((s, p) => s.plus(p.totalSalesTax), ZERO);
  const years = new Map<
    number,
    { realized: Decimal; income: Decimal; foreignIncome: Decimal; tax: Decimal }
  >();
  for (const y of parts.flatMap((p) => p.byYear)) {
    const acc = years.get(y.year) ?? {
      realized: ZERO,
      income: ZERO,
      foreignIncome: ZERO,
      tax: ZERO,
    };
    acc.realized = acc.realized.plus(y.realized);
    acc.income = acc.income.plus(y.income);
    acc.foreignIncome = acc.foreignIncome.plus(y.foreignIncome);
    acc.tax = acc.tax.plus(y.tax);
    years.set(y.year, acc);
  }
  return {
    disposals,
    totalProceeds: totalProceeds.toFixed(2),
    totalSalesTax: totalSalesTax.toFixed(2),
    income,
    ...incomeTotals(income, totalSalesTax),
    byYear: [...years.entries()]
      .sort(([a], [b]) => b - a)
      .map(([year, v]) => ({
        year,
        realized: v.realized.toFixed(2),
        income: v.income.toFixed(2),
        foreignIncome: v.foreignIncome.toFixed(2),
        tax: v.tax.toFixed(2),
      })),
  };
}

/**
 * Indonesian final-tax helpers for a resident individual: the flat tax on listed-share
 * sale proceeds plus a final tax on investment income whose rate depends on the TYPE and
 * SOURCE of the income.
 *
 * Scope (sources: docs/tax.md › "Indonesian final-tax regime"):
 *   - Sales tax: 0.1% of the gross sale value (consumed quantity × price, fees excluded)
 *     for disposals of IDX-listed shares (the caller filters disposals to
 *     `market === "IDX" && assetClass === "equity"`), withheld by the exchange through
 *     the broker. PP 41/1994 as amended by PP 14/1997; KMK 282/KMK.04/1997. A
 *     withholding recorded on the sell is the figure for that disposal; the 0.1% applies
 *     only when none was recorded. The caller passes that decided amount (`tax` /
 *     `salesTax`); when it is omitted, this module multiplies `proceeds` by the rate.
 *   - Crypto sales (PMK 68/2022, PMK 50/2025): a separate final tax on gross sale value,
 *     rate by venue and sale date ({@link ID_CRYPTO_RATE_TABLE}). Not the 0.1%. No estimate
 *     before 2022-05-01, and the old PPN is not modelled. Folded into `estimatedTax` and
 *     `taxWithheldAtSource`.
 *   - Investment income, classified per transaction by {@link classifyIdIncome}:
 *       domestic_dividend  10% final of gross, paid by the investor by the 15th of the
 *                          following month (nothing is withheld for a resident individual);
 *                          EXEMPT if reinvested in Indonesia for at least 3 tax years.
 *                          UU PPh Art. 4(3)(f) and 17(2c) as amended by UU HPP 7/2021;
 *                          PMK 18/PMK.03/2021; PMK 81/2024 Art. 370–374.
 *       bond_interest      10% final of gross interest for the holding period (government
 *                          bonds and SBN retail included), withheld by the issuer or
 *                          custodian. PP 91/2021 Art. 2, from 30 Aug 2021 (15% before).
 *                          Coupons keep today's 10% unless a withholding is recorded.
 *       bond_discount      10% final of the discount on an Indonesian bond or sukuk
 *                          (sell price − clean cost) × quantity, fees excluded. PP 91/2021
 *                          Art. 2(3), from 30 Aug 2021; 15% on a sale before that date
 *                          ({@link ID_BOND_RATE_TABLE}). Withheld at source. Not the 0.1%
 *                          share tax. A par redemption adds nothing. A discount below cost
 *                          is informational (`negative_discount`): tax zero, and it does
 *                          not refund coupons already booked — Art. 2(4)'s accrued-coupon
 *                          offset is not computed. Price is clean (`transactions.price`);
 *                          a dirty price would overstate the discount.
 *       deposit_interest   20% final of gross interest on deposits, savings and current
 *                          accounts, withheld by the bank. PP 131/2000 as amended by
 *                          PP 123/2015; PMK 212/PMK.03/2018. Not withheld when the deposit
 *                          and savings amount does not exceed Rp7,500,000 (PMK 212 Art. 7(a),
 *                          PP 131/2000 Art. 3(1)(a)). Approximated per portfolio, treating
 *                          one portfolio as one bank: see {@link idDepositInterestExempt}.
 *       fund_distribution  0%: profit distributed by a collective investment contract
 *                          (reksa dana, IDX ETF, DIRE) is not an income-tax object for the
 *                          unit holder. UU PPh Art. 4(3)(i).
 *       foreign            Foreign-source income is outside these final regimes: it is
 *                          ordinary income at the progressive Art. 17 rates (5–35%) with a
 *                          foreign tax credit (UU PPh Art. 24, PMK 192/PMK.03/2018), or
 *                          exempt to the extent it is reinvested in Indonesia (PMK 18/2021).
 *                          Pocket can't know the marginal rate, so it is reported
 *                          separately and kept out of the estimate.
 *   - For the categories withheld at source (bond interest, bond discount and deposit
 *     interest), a withholding recorded on the transaction is the tax figure; the
 *     statutory rate is only applied when none is recorded. A domestic dividend is always
 *     `gross × 10%` (nothing is withheld for a resident individual, so a recorded tax
 *     there is not Indonesian tax).
 *   - No annual allowance, no tax-loss harvesting, no realized-gain-based computation
 *     (unlike the German path in `tax.ts`).
 *
 * This is an estimate, not tax advice. All money amounts are Decimal strings (never
 * floats) in, and out.
 */

import { Decimal } from "decimal.js";
import { D } from "./decimal.js";
import type { TAXED_INCOME_TYPES } from "./categorization.js";
import { cashBalances, cashFlow, isCashAccountMovement } from "./cash.js";
import { tryConvert, type FxRateFn } from "./networth.js";
import type { CoreTransaction } from "./types.js";

/** 0.1% of gross proceeds of IDX-listed shares (PP 41/1994 as amended by PP 14/1997). */
export const ID_SALES_TAX_RATE = "0.001";
/** Domestic dividends, resident individual: 10% final unless reinvested ≥3 years
 *  (UU PPh Art. 17(2c), 4(3)(f)). */
export const ID_DOMESTIC_DIVIDEND_TAX_RATE = "0.10";
/** Bond interest/coupons, resident individual: 10% final (PP 91/2021, from 30 Aug 2021). */
export const ID_BOND_INTEREST_TAX_RATE = "0.10";
/**
 * Final rate on Indonesian bond and sukuk discount (and the coupon rate before the
 * cutover). The latest span whose `from` is on or before the sale date wins.
 * PP 91/2021: 10% from 30 Aug 2021; 15% before that.
 */
export const ID_BOND_RATE_TABLE: readonly { from: string; rate: string }[] = [
  { from: "0000-01-01", rate: "0.15" },
  { from: "2021-08-30", rate: "0.10" },
];

/** The rate in `table` that applies on `on` (YYYY-MM-DD). */
export function idRateOn(table: readonly { from: string; rate: string }[], on: string): string {
  let rate = table[0]?.rate ?? "0";
  for (const span of table) {
    if (on >= span.from) rate = span.rate;
  }
  return rate;
}

/** Where a crypto sale was made, for PMK 68/2022 and PMK 50/2025. The rate follows the
 *  platform, not the coin. */
export type IdCryptoVenue = "domestic" | "foreign";

/**
 * PPh final on crypto sale value (quantity × price). Null means no estimate: before
 * PMK 68/2022 (1 May 2022) this module does not invent a rate, and it does not model
 * the old PPN. From 1 Aug 2025, PMK 50/2025: 0.21% domestic, 1% foreign.
 */
export const ID_CRYPTO_RATE_TABLE: readonly {
  from: string;
  domestic: string | null;
  foreign: string | null;
}[] = [
  { from: "0000-01-01", domestic: null, foreign: null },
  { from: "2022-05-01", domestic: "0.001", foreign: "0.002" },
  { from: "2025-08-01", domestic: "0.0021", foreign: "0.01" },
];

/** The crypto sales-tax rate on `on`, or null when that date has no estimate. */
export function idCryptoRate(venue: IdCryptoVenue, on: string): string | null {
  let span = ID_CRYPTO_RATE_TABLE[0];
  for (const row of ID_CRYPTO_RATE_TABLE) {
    if (on >= row.from) span = row;
  }
  if (!span) return null;
  return venue === "domestic" ? span.domestic : span.foreign;
}

/** Portfolio setting, else the country fallback. Null venue + country `ID` is domestic.
 *  Null venue + any other country (or none) is no crypto sales tax. An explicit venue
 *  wins over the country. */
export function idCryptoVenue(
  venue: string | null | undefined,
  country: string | null | undefined,
): IdCryptoVenue | null {
  const set = venue?.trim().toLowerCase();
  if (set === "domestic" || set === "foreign") return set;
  if ((country ?? "").trim().toUpperCase() === "ID") return "domestic";
  return null;
}

/** Venues whose instruments are Indonesian for income classification. The 0.1% share
 *  sale stays IDX equity only — these aliases must not widen it. */
const INDONESIAN_VENUES = new Set(["IDX", "SBN", "KSEI", "IBPA", "PHEI"]);

export function isIndonesianInstrument(instrument: {
  market: string;
  isin?: string | null;
}): boolean {
  return (
    INDONESIAN_VENUES.has(instrument.market.toUpperCase()) || /^ID/i.test(instrument.isin ?? "")
  );
}
/** Bank deposit, savings and current-account interest: 20% final (PP 131/2000,
 *  PMK 212/PMK.03/2018). */
export const ID_DEPOSIT_INTEREST_TAX_RATE = "0.20";
/** Reksa dana / ETF distributions to the unit holder: not a tax object (UU PPh 4(3)(i)). */
export const ID_FUND_DISTRIBUTION_TAX_RATE = "0";
/** Deposit + savings amount at or below which bank interest is not taxed ("tidak
 *  melebihi Rp7.500.000,00", PMK 212/2018 Art. 7(a); PP 131/2000 Art. 3(1)(a)). */
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
  /** Gross sale value (quantity × price, fees excluded). Not the fee-net figure used for gain. */
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
  /** Decided sales tax for this row: a recorded withholding, `proceeds × 0.001`, or a
   *  mix of the two. When omitted, this module applies the rate to `proceeds`. */
  tax?: string;
  /** How `tax` was decided. Omitted by callers that leave the rate to this module. */
  taxBasis?: IdIncomeTaxBasis;
}

export interface IdDisposalTax extends IdDisposalInput {
  /** Decided sales tax, decimal string. `proceeds × 0.1%` unless the caller passed `tax`. */
  tax: string;
}

/** One crypto sale already in the report currency. Buys are not passed. */
export interface IdCryptoDisposalInput {
  symbol: string;
  instrumentId?: string | null;
  /** Sale date, YYYY-MM-DD. Selects the rate table. */
  when: string;
  /** Gross sale value (quantity × price, fees excluded). */
  proceeds: string;
  venue: IdCryptoVenue;
  /** Recorded withholding. Omitted or not greater than zero means use the rate table. */
  tax?: string;
}

export interface IdCryptoDisposalTax {
  symbol: string;
  instrumentId?: string | null;
  when: string;
  proceeds: string;
  venue: IdCryptoVenue;
  /** Statutory rate, or null when the date is before any estimate and nothing was recorded. */
  rate: string | null;
  tax: string;
  taxBasis: IdIncomeTaxBasis | null;
}

/** How a row of investment income is taxed for an Indonesian resident individual. */
export type IdIncomeCategory =
  | "domestic_dividend"
  | "bond_interest"
  | "bond_discount"
  | "deposit_interest"
  | "fund_distribution"
  | "foreign";

/** Display order of the categories (the UI and the rollup follow it). */
export const ID_INCOME_CATEGORIES: readonly IdIncomeCategory[] = [
  "domestic_dividend",
  "bond_interest",
  "bond_discount",
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
    case "bond_discount":
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
  return (
    category === "bond_interest" || category === "bond_discount" || category === "deposit_interest"
  );
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
 * transaction currency: an instrument is domestic when {@link isIndonesianInstrument}
 * says so (IDX, or the bond venues SBN / KSEI / IBPA / PHEI, or an ISIN prefixed `ID`).
 * Those bond venues widen income classification only — they must not become 0.1% share
 * sales. Cash interest has no instrument, so it is decided by the portfolio's country
 * (where the account is held): `ID` is an Indonesian bank, 20% final in any currency (a
 * USD deposit at an Indonesian bank included, PMK 212/2018); any other country is foreign
 * income in any currency. With no country set, the currency is the fallback: IDR interest
 * is treated as Indonesian, interest in any other currency as foreign (docs/tax.md).
 */
export function classifyIdIncome(input: IdIncomeClassifyInput): IdIncomeCategory {
  const inst = input.instrument ?? null;
  const country = input.portfolioCountry?.trim().toUpperCase() || null;
  const domestic = inst
    ? isIndonesianInstrument(inst)
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
  type: (typeof TAXED_INCOME_TYPES)[number];
  /** The transaction's own currency (ISO 4217). */
  currency: string;
}

/** Why a row of income carries no tax although its category has a rate. */
export type IdIncomeExemption = "small_balance" | "negative_discount";

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
  /** Sale date (YYYY-MM-DD) of a bond discount. Selects the 15% → 10% cutover. */
  on?: string;
  /** Bank interest only: the paying portfolio's whole cash balance (every currency) in IDR
   *  just before the interest was credited — see {@link idDepositBalanceIdr}. null or
   *  absent when it can't be known; the interest is then taxed at the full rate. */
  depositBalanceIdr?: string | null;
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
  /** The rate applied: the category's final rate, "0" when {@link exemption} is set; null
   *  for foreign income. */
  rate: string | null;
  /** Set when the row carries no tax although its category has a rate.
   *  `"small_balance"`: bank interest on a balance ≤ {@link ID_DEPOSIT_EXEMPT_BALANCE_IDR}.
   *  `"negative_discount"`: a bond sold below clean cost. Not a refund of coupons
   *  (PP 91/2021 Art. 2(4) is not computed). The negative amount is shown; tax is zero.
   *  Exempt rows count in the gross totals but add nothing to the tax. null otherwise. */
  exemption: IdIncomeExemption | null;
  gross: string;
  /** Indonesian final tax; null for foreign income (not part of the estimate). */
  tax: string | null;
  /** gross − tax; null for foreign income. */
  net: string | null;
  /** True when the payer withholds this tax (bond interest, bond discount, deposit interest). */
  withheldAtSource: boolean;
  /** Whether `tax` is the recorded withholding, the rate applied, or both across rows;
   *  null for foreign income and for the 0% fund distributions. */
  taxBasis: IdIncomeTaxBasis | null;
  /** Foreign income only: the foreign tax recorded as withheld (creditable). */
  foreignTaxWithheld: string | null;
}

export interface IdIncomeCategoryTotal {
  category: IdIncomeCategory;
  /** The category's final rate (exempt rows included, see `exemptGross`). */
  rate: string | null;
  gross: string;
  /** The part of `gross` that is exempt (rows with an `exemption`), "0.00" when none. */
  exemptGross: string;
  /** null for foreign income. */
  tax: string | null;
  withheldAtSource: boolean;
}

export interface IdYearInput {
  year: number;
  /** Sum of in-scope sale values closed in this tax year (the statutory base). */
  proceeds: string;
  /** Decided sales tax for the year. When omitted, `proceeds × 0.001`. */
  salesTax?: string;
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
  /** Crypto sales of every year. Omitted means none. Not part of the 0.1% share total. */
  cryptoDisposals?: IdCryptoDisposalInput[];
}

export interface IndonesianFinalTax {
  disposals: IdDisposalTax[];
  totalProceeds: string;
  /** 0.1% IDX share sales only. Crypto is {@link totalCryptoTax}. */
  totalSalesTax: string;
  /** Crypto sales in the selected year. Separate from {@link disposals}. */
  cryptoDisposals: IdCryptoDisposalTax[];
  /** Gross crypto sale value in the selected year. */
  totalCryptoProceeds: string;
  /** Final tax on those crypto sales. Withheld at source. */
  totalCryptoTax: string;
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
  /** totalSalesTax + totalCryptoTax + totalIncomeTax — the hero-card headline figure. */
  estimatedTax: string;
  /** The part of `estimatedTax` the payer withholds (share sales, crypto sales, bond
   *  interest, bond discount and deposit interest). */
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

/**
 * The portfolio's cash balance per currency when an interest payment is credited, the
 * payment itself left out: {@link cashBalances} — the same ledger holdings and net worth
 * use, never a second one — over every other transaction executed at or before it. Rows
 * at the very same instant are included (a per-currency sum doesn't depend on their order),
 * so a deposit booked on the payment's date-only timestamp counts; that errs toward the
 * larger balance, i.e. toward taxing. `payment` is excluded by identity: pass the element of
 * `transactions` itself, not a rebuilt copy (which would count into its own balance). The
 * reference definition: the tax report uses {@link idCashBalancesAtPayments}, which must
 * stay equal to it (keep both; the tests compare them).
 *
 * null when the balance can't be known: before the first explicit cash-account movement
 * ({@link isCashAccountMovement}) the derived cash is only the sum of imported trades, not
 * a balance. Unlike net worth, this does not depend on the portfolio's `cashCounted`
 * boundary: cash outside the performance boundary still sits at the bank and earns interest.
 */
export function idCashBalancesBefore(
  transactions: CoreTransaction[],
  payment: CoreTransaction,
): Record<string, string> | null {
  const at = payment.executedAt.getTime();
  const before = transactions.filter((t) => t !== payment && t.executedAt.getTime() <= at);
  if (!before.some(isCashAccountMovement)) return null;
  return cashBalances(before);
}

/**
 * {@link idCashBalancesBefore} for many payments of one portfolio in a single sorted walk
 * (O(n log n) instead of a full ledger pass per payment), keyed by the payment rows passed
 * in. Same record, payment by payment — `tax-id.test.ts` pins the parity. Only payments that
 * are elements of `transactions` get an entry; any other is absent (its balance unknown).
 */
export function idCashBalancesAtPayments(
  transactions: CoreTransaction[],
  payments: CoreTransaction[],
): Map<CoreTransaction, Record<string, string> | null> {
  const out = new Map<CoreTransaction, Record<string, string> | null>();
  const wanted = new Set(payments);
  if (wanted.size === 0) return out;
  const sorted = [...transactions].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
  const totals = new Map<string, Decimal>();
  // Rows per currency, so a currency only the payment itself uses isn't reported as "0".
  const rows = new Map<string, number>();
  let tracked = false;
  for (let i = 0; i < sorted.length;) {
    // One instant at a time: every row at the payment's instant counts, except the payment.
    const at = sorted[i]!.executedAt.getTime();
    let j = i;
    for (; j < sorted.length && sorted[j]!.executedAt.getTime() === at; j++) {
      const t = sorted[j]!;
      totals.set(t.currency, (totals.get(t.currency) ?? ZERO).add(cashFlow(t)));
      rows.set(t.currency, (rows.get(t.currency) ?? 0) + 1);
      if (isCashAccountMovement(t)) tracked = true;
    }
    for (let k = i; k < j; k++) {
      const p = sorted[k]!;
      if (!wanted.has(p)) continue;
      // The payment's own row is never a cash-account movement, so `tracked` holds as is.
      if (!tracked) {
        out.set(p, null);
        continue;
      }
      const balances: Record<string, string> = {};
      for (const [currency, total] of totals) {
        if (currency !== p.currency) balances[currency] = total.toString();
        else if (rows.get(currency)! > 1) balances[currency] = total.minus(cashFlow(p)).toString();
      }
      out.set(p, balances);
    }
    i = j;
  }
  return out;
}

/**
 * A per-currency cash balance in IDR, summed: the amount PMK 212/2018 Art. 7(a) compares
 * with Rp7,500,000. Foreign-currency deposits count (a "Deposito" is in rupiah or a foreign
 * currency, Art. 1(1)), converted with `fx` — the rates of the payment date. null when the
 * balance is unknown or a non-zero currency has no rate into IDR (then it can't be
 * totalled, and the interest is taxed at the full rate).
 */
export function idDepositBalanceIdr(
  balances: Record<string, string> | null,
  fx: FxRateFn,
): string | null {
  if (balances === null) return null;
  let total = ZERO;
  for (const [currency, amount] of Object.entries(balances)) {
    if (D(amount).isZero()) continue;
    const idr = tryConvert(amount, currency, "IDR", fx);
    if (idr === null) return null;
    total = total.plus(idr);
  }
  return total.toString();
}

/**
 * Whether bank interest is exempt as a small balance: the balance is known and between 0
 * and {@link ID_DEPOSIT_EXEMPT_BALANCE_IDR} inclusive ("tidak melebihi", not more than). A
 * negative balance is a data gap (missing deposits), not a small balance: not exempt. Zero
 * is exempt: once explicit cash movements are recorded (otherwise the balance is unknown),
 * an account spent down to 0 — an RDN whose cash all went into a purchase — really holds
 * nothing at the bank.
 */
export function idDepositInterestExempt(balanceIdr: string | null | undefined): boolean {
  if (balanceIdr === null || balanceIdr === undefined) return false;
  const balance = D(balanceIdr);
  return balance.gte(0) && balance.lte(ID_DEPOSIT_EXEMPT_BALANCE_IDR);
}

/** The Indonesian final tax on one income row, or null for foreign income. */
function incomeRowTax(r: IdIncomeInput): {
  tax: Decimal;
  basis: "recorded" | "estimated" | null;
  exemption: IdIncomeExemption | null;
} | null {
  if (idIncomeTaxRate(r.category) === null) return null;
  const recorded = D(r.recordedTax);
  // A withholding the bank recorded wins over the approximation: the bank knows the
  // customer's whole balance with it, Pocket only this portfolio's.
  if (idIncomeWithheldAtSource(r.category) && recorded.gt(0)) {
    return { tax: recorded, basis: "recorded", exemption: null };
  }
  // A discount below cost is not a refund of coupons already withheld (PP 91/2021
  // Art. 2(4) only offsets unpaid accrued coupon, which this estimate does not compute).
  if (r.category === "bond_discount" && D(r.gross).lte(0)) {
    return { tax: ZERO, basis: null, exemption: "negative_discount" };
  }
  if (r.category === "deposit_interest" && idDepositInterestExempt(r.depositBalanceIdr)) {
    return { tax: ZERO, basis: null, exemption: "small_balance" };
  }
  const rate =
    r.category === "bond_discount"
      ? idRateOn(ID_BOND_RATE_TABLE, r.on ?? `${r.year}-12-31`)
      : idIncomeTaxRate(r.category)!;
  const tax = D(r.gross).times(rate);
  return { tax, basis: tax.isZero() && D(rate).isZero() ? null : "estimated", exemption: null };
}

type IncomeAcc = {
  instrumentId?: string | null;
  symbol: string;
  cashSource?: IdCashIncomeSource | null;
  currency: string;
  category: IdIncomeCategory;
  exemption: IdIncomeExemption | null;
  gross: Decimal;
  tax: Decimal;
  recorded: Decimal;
  bases: Set<"recorded" | "estimated">;
  /** Rate actually applied, when it is not the category's current rate. */
  appliedRate?: string;
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
    rate: a.exemption ? "0" : (a.appliedRate ?? idIncomeTaxRate(a.category)),
    exemption: a.exemption,
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
    const exempt = of.filter((r) => r.exemption).reduce((s, r) => s.plus(r.gross), ZERO);
    out.push({
      category,
      rate: idIncomeTaxRate(category),
      gross: gross.toFixed(2),
      exemptGross: exempt.toFixed(2),
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
  totalCryptoTax: Decimal,
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
    estimatedTax: totalSalesTax.plus(totalCryptoTax).plus(tax).toFixed(2),
    taxWithheldAtSource: totalSalesTax.plus(totalCryptoTax).plus(withheld).toFixed(2),
    taxToSelfPay: selfPay.toFixed(2),
  };
}

/**
 * Compute Indonesian final tax for the selected year's disposals and income, plus a
 * per-year rollup across every year the inputs cover. Coupons and the other income
 * categories use today's rates (a coupon's 15% → 10% change of 30 Aug 2021 is not
 * replayed) unless a withholding is recorded. Bond discount uses {@link ID_BOND_RATE_TABLE}
 * on the sale date (`IdIncomeInput.on`).
 */
export function indonesianFinalTax(input: IndonesianFinalTaxInput): IndonesianFinalTax {
  const salesRate = D(ID_SALES_TAX_RATE);

  let totalProceeds = ZERO;
  let totalSalesTax = ZERO;
  const disposals: IdDisposalTax[] = input.disposals.map((r) => {
    const proceeds = D(r.proceeds);
    // A caller that already decided the tax (recorded withholding, or gross × rate
    // computed off the trade log) passes it. Everyone else is taxed on `proceeds`.
    const tax = r.tax !== undefined ? D(r.tax) : proceeds.times(salesRate);
    totalProceeds = totalProceeds.plus(proceeds);
    totalSalesTax = totalSalesTax.plus(tax);
    return { ...r, tax: tax.toFixed(2) };
  });

  // Crypto is not the 0.1%. A date with no rate and no recorded withholding is omitted
  // (no invented zero). Rows of other years still feed `byYear`.
  let totalCryptoProceeds = ZERO;
  let totalCryptoTax = ZERO;
  const cryptoByYear = new Map<number, Decimal>();
  const cryptoDisposals: IdCryptoDisposalTax[] = [];
  for (const r of input.cryptoDisposals ?? []) {
    const proceeds = D(r.proceeds);
    const recorded = r.tax !== undefined && D(r.tax).gt(0) ? D(r.tax) : null;
    const rate = idCryptoRate(r.venue, r.when);
    if (recorded === null && rate === null) continue;
    const tax = recorded ?? proceeds.times(rate!);
    const year = Number(r.when.slice(0, 4));
    cryptoByYear.set(year, (cryptoByYear.get(year) ?? ZERO).plus(tax));
    if (year !== input.year) continue;
    totalCryptoProceeds = totalCryptoProceeds.plus(proceeds);
    totalCryptoTax = totalCryptoTax.plus(tax);
    cryptoDisposals.push({
      symbol: r.symbol,
      ...(r.instrumentId !== undefined ? { instrumentId: r.instrumentId } : {}),
      when: r.when,
      proceeds: proceeds.toFixed(2),
      venue: r.venue,
      rate: rate,
      tax: tax.toFixed(2),
      taxBasis: recorded ? "recorded" : "estimated",
    });
  }

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
    // though both are reported in the display currency. Exempt and taxed payments of one
    // source stay apart too, so every row has a single rate.
    const source = r.instrumentId
      ? r.instrumentId
      : r.cashSource
        ? `cash:${r.cashSource.type}:${r.cashSource.currency}`
        : r.symbol;
    const exemption = rowTax?.exemption ?? null;
    const appliedRate =
      r.category === "bond_discount" && !exemption
        ? idRateOn(ID_BOND_RATE_TABLE, r.on ?? `${r.year}-12-31`)
        : undefined;
    const key = `${source}:${r.currency}:${r.category}:${exemption ?? ""}:${appliedRate ?? ""}`;
    const acc = groups.get(key) ?? {
      ...(r.instrumentId !== undefined ? { instrumentId: r.instrumentId } : {}),
      symbol: r.symbol,
      ...(r.cashSource ? { cashSource: r.cashSource } : {}),
      currency: r.currency,
      category: r.category,
      exemption,
      ...(appliedRate ? { appliedRate } : {}),
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

  const years = new Set<number>([
    ...input.byYear.map((y) => y.year),
    ...incomeByYear.keys(),
    ...cryptoByYear.keys(),
  ]);
  const byYear: IdYearTax[] = [...years]
    .sort((a, b) => b - a)
    .map((year) => {
      const t = input.byYear.find((y) => y.year === year);
      const inc = incomeByYear.get(year) ?? { income: ZERO, foreign: ZERO, tax: ZERO };
      const salesTax =
        t?.salesTax !== undefined ? D(t.salesTax) : D(t?.proceeds ?? "0").times(salesRate);
      return {
        year,
        realized: D(t?.realized ?? "0").toFixed(2),
        income: inc.income.toFixed(2),
        foreignIncome: inc.foreign.toFixed(2),
        tax: salesTax
          .plus(inc.tax)
          .plus(cryptoByYear.get(year) ?? ZERO)
          .toFixed(2),
      };
    });

  return {
    disposals,
    totalProceeds: totalProceeds.toFixed(2),
    totalSalesTax: totalSalesTax.toFixed(2),
    cryptoDisposals,
    totalCryptoProceeds: totalCryptoProceeds.toFixed(2),
    totalCryptoTax: totalCryptoTax.toFixed(2),
    income,
    ...incomeTotals(income, totalSalesTax, totalCryptoTax),
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
  const cryptoDisposals = parts.flatMap((p) => p.cryptoDisposals ?? []);
  const income = parts.flatMap((p) => p.income);
  const totalProceeds = parts.reduce((s, p) => s.plus(p.totalProceeds), ZERO);
  const totalSalesTax = parts.reduce((s, p) => s.plus(p.totalSalesTax), ZERO);
  const totalCryptoProceeds = parts.reduce((s, p) => s.plus(p.totalCryptoProceeds ?? "0"), ZERO);
  const totalCryptoTax = parts.reduce((s, p) => s.plus(p.totalCryptoTax ?? "0"), ZERO);
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
    cryptoDisposals,
    totalCryptoProceeds: totalCryptoProceeds.toFixed(2),
    totalCryptoTax: totalCryptoTax.toFixed(2),
    income,
    ...incomeTotals(income, totalSalesTax, totalCryptoTax),
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

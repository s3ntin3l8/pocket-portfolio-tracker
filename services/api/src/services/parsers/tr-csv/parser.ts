import { parsedTransactionSchema, type ParsedTransaction } from "@portfolio/schema";
import type { CsvParseResult } from "../csv.js";
import { splitCsvLine } from "../csv-line.js";
import { formatDecimal } from "../numeric.js";
import { collapsePerkFundedAcquisitions } from "../perk-pairing.js";
import { tryAddDraft, type ParserError } from "../shared.js";
import {
  ISIN_RE,
  DEPOSIT_TYPES,
  WITHDRAWAL_TYPES,
  CARD_TYPES,
  DIVIDEND_TYPES,
  CASH_BONUS_TYPES,
  SHARE_IN_TYPES,
  UNSUPPORTED,
} from "./constants.js";
import { toNum, assetClassOf, decodeName } from "./helpers.js";

/**
 * Parse a Trade Republic transaction-export CSV into draft transactions. Each recognised
 * row becomes a draft (confidence 1); rows of a recognised-but-unmappable type, and rows
 * missing required figures, are collected as errors rather than failing the whole import.
 * Rows of an *unrecognised* type become "attention" issues the user can map manually in
 * the review screen — never silently dropped.
 */
export function parseTrCsv(content: string): CsvParseResult {
  const stripped = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = stripped.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const drafts: ParsedTransaction[] = [];
  const errors: CsvParseResult["errors"] = [];
  if (lines.length < 2) return { drafts, errors };

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const cols = {
    datetime: idx("datetime"),
    date: idx("date"),
    type: idx("type"),
    assetClass: idx("asset_class"),
    name: idx("name"),
    symbol: idx("symbol"),
    shares: idx("shares"),
    price: idx("price"),
    amount: idx("amount"),
    fee: idx("fee"),
    tax: idx("tax"),
    currency: idx("currency"),
    fxRate: idx("fx_rate"),
    txId: idx("transaction_id"),
    description: idx("description"),
  };

  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const get = (j: number) => (j >= 0 ? (c[j] ?? "") : "");
    const fail = (message: string) => errors.push({ line: i + 1, message });

    const type = get(cols.type).trim().toUpperCase();
    const amount = toNum(get(cols.amount));
    const fee = toNum(get(cols.fee));
    const tax = toNum(get(cols.tax));
    const shares = toNum(get(cols.shares));
    const priceCol = toNum(get(cols.price));

    const symbol = get(cols.symbol).trim();
    const isin = ISIN_RE.test(symbol) ? symbol : undefined;
    const ticker = isin ? undefined : symbol || undefined;
    const name = decodeName(get(cols.name)) || undefined;
    const assetClass = assetClassOf(get(cols.assetClass));
    const fxRate = get(cols.fxRate).trim() || undefined;

    // Fields shared by every draft. Currency defaults to EUR for the share-in corporate
    // actions, whose cash currency column is blank.
    const base = {
      currency: get(cols.currency).trim() || "EUR",
      executedAt: get(cols.datetime),
      externalId: `tr-csv:${get(cols.txId)}`,
      confidence: 1 as const,
      fxRate,
    };
    const instrument = { assetClass, isin, ticker, name };

    let candidate: Record<string, unknown>;

    if (type === "BUY" || type === "SELL") {
      if (shares == null || priceCol == null || amount == null) {
        fail(`${type} row missing shares/price/amount`);
        continue;
      }
      // CSV sell `tax` column: negative = capital-gains tax withheld. Captured so
      // cashFlow (sell) = qty·price − fees − tax matches the invariant Σ(amount+fee+tax).
      // Buy rows don't carry tax (German KapSt only applies to proceeds, not purchases).
      const sellTax =
        type === "SELL" && tax != null && tax !== 0 ? formatDecimal(Math.abs(tax)) : undefined;
      candidate = {
        ...base,
        ...instrument,
        action: type === "BUY" ? "buy" : "sell",
        quantity: formatDecimal(Math.abs(shares)),
        unit: assetClass === "crypto" ? "units" : "shares",
        price: formatDecimal(Math.abs(priceCol)), // gross per-share price (amount / shares)
        fees: fee != null ? formatDecimal(Math.abs(fee)) : "0",
        tax: sellTax,
        total: formatDecimal(Math.abs(amount) + Math.abs(fee ?? 0)), // gross consideration incl. fee
      };
    } else if (DIVIDEND_TYPES.has(type)) {
      if (amount == null) {
        fail(`${type} row missing amount`);
        continue;
      }
      // CSV sign: `amount` = signed gross, `tax` = negative for a withholding, positive for
      // a refund/reversal. net = amount + tax. We store `price` = signed net (drives
      // cashFlow/XIRR), and convert the CSV tax to the app's convention: positive = withheld,
      // negative = refund — i.e. stored_tax = −csv_tax. A reversal row (amount < 0, tax > 0)
      // produces a negative price (cash out) and a negative stored_tax (refund tag).
      const taxSigned = tax ?? 0; // CSV: negative = withheld, positive = refunded
      const net = amount + taxSigned; // signed net cash credited
      // A US-REIT 1099-DIV recharacterization (e.g. Realty Income every March) reverses and
      // reissues a prior distribution; TR posts these MONTHS after the true payment but keeps
      // `date` pinned to the original economic day while `datetime` carries the late posting
      // timestamp — `date` and `datetime` can differ by up to a year. `datetime` is right for
      // every other row type (posted same-day), so only dividends fall back to `date`.
      const economicDate = get(cols.date).trim();
      candidate = {
        ...base,
        ...(economicDate ? { executedAt: economicDate } : {}),
        ...instrument,
        action: "dividend",
        quantity: "0", // the CSV `shares` here is the holding, not a traded quantity
        unit: assetClass ? "shares" : undefined,
        price: formatDecimal(net), // signed NET drives cashFlow/XIRR; negative for reversals
        total: formatDecimal(amount), // signed gross (display only; not persisted)
        tax: taxSigned !== 0 ? formatDecimal(-taxSigned) : undefined, // +withheld / −refund
        fees: "0",
        // The CSV `shares` column IS the holding the dividend was paid on (#508) — unlike a
        // BUY/SELL row, there's no separate per-share `price` column for a dividend, so
        // `perShare` is left for the read-time derived fallback (gross/shares) to fill.
        shares: shares != null ? formatDecimal(Math.abs(shares)) : undefined,
      };
    } else if (type === "INTEREST_PAYMENT") {
      if (amount == null) {
        fail("INTEREST_PAYMENT row missing amount");
        continue;
      }
      // Mirror the dividend net-into-price convention (lines above): `price` = net cash so
      // cashFlow reads the right amount. CSV tax is negative for a withholding.
      const taxSigned = tax ?? 0;
      const net = amount + taxSigned; // amount - |withheld|
      candidate = {
        ...base,
        action: "interest",
        quantity: "0",
        price: formatDecimal(Math.abs(net)),
        tax: taxSigned !== 0 ? formatDecimal(-taxSigned) : undefined, // +withheld / −refund
        fees: "0",
      };
    } else if (type === "EARNINGS") {
      // German Vorabpauschale (advance lump-sum fund tax): the gross payout is 0 and only a
      // `tax` is withheld, so the net cash effect is −|tax|. It's a standalone tax debit, not
      // income — model it as the first-class `tax` type with the magnitude in `price`
      // (cashFlow(tax) = −price). No instrument leg; the name labels it. Excluded from
      // holdings/contributions/income; reduces cash and total return.
      if (tax == null) {
        fail("EARNINGS row missing tax");
        continue;
      }
      candidate = {
        ...base,
        name: decodeName(get(cols.description)) || name || "Vorabpauschale",
        action: "tax",
        quantity: "0",
        price: formatDecimal(Math.abs(tax)),
        fees: "0",
      };
    } else if (DEPOSIT_TYPES.has(type)) {
      if (amount == null) {
        fail(`${type} row missing amount`);
        continue;
      }
      candidate = {
        ...base,
        action: "deposit",
        quantity: "0",
        price: formatDecimal(Math.abs(amount)),
        fees: "0",
      };
    } else if (WITHDRAWAL_TYPES.has(type) || CARD_TYPES.has(type)) {
      if (amount == null) {
        fail(`${type} row missing amount`);
        continue;
      }
      candidate = {
        ...base,
        action: "withdrawal",
        quantity: "0",
        price: formatDecimal(Math.abs(amount)),
        fees: "0",
      };
    } else if (type === "CARD_ORDERING_FEE") {
      const charge = fee ?? amount ?? 0;
      candidate = {
        ...base,
        action: "withdrawal",
        quantity: "0",
        price: formatDecimal(Math.abs(charge)),
        fees: "0",
      };
    } else if (CASH_BONUS_TYPES.has(type)) {
      if (amount == null) {
        fail(`${type} row missing amount`);
        continue;
      }
      // Reward credit (saveback / Kindergeld / stock perk / promo) — income but distinct from
      // uninvested-cash interest so it shows as "Bonus". `kind: "bonus"` drives the perk
      // collapse (collapsePerkFundedAcquisitions) and backfill matching.
      candidate = {
        ...base,
        name,
        action: "bonus_cash",
        quantity: "0",
        price: formatDecimal(Math.abs(amount)),
        fees: "0",
        kind: "bonus",
      };
    } else if (SHARE_IN_TYPES.has(type)) {
      if (shares == null || shares === 0) {
        fail(`${type} row missing a share count`);
        continue;
      }
      if (type === "FREE_RECEIPT") {
        // Discriminator: a TR-issued grant (BTC/ETH promo) has a price; a genuine
        // depot-to-depot share transfer (Depotübertrag) has no price.
        if (priceCol != null && priceCol !== 0) {
          // Crypto/promo grant: income at market basis. NOT a contribution.
          candidate = {
            ...base,
            ...instrument,
            action: "bonus",
            quantity: formatDecimal(Math.abs(shares)),
            unit: assetClass === "crypto" ? "units" : "shares",
            price: formatDecimal(Math.abs(priceCol)),
            fees: "0",
          };
        } else {
          // Depot transfer: carried cost basis is unknown — emit a low-confidence draft
          // so the review screen prompts the user to set the original cost basis.
          // action:"transfer_in" is the first-class type from PR #309.
          candidate = {
            ...base,
            ...instrument,
            action: "transfer_in",
            quantity: formatDecimal(Math.abs(shares)),
            unit: "shares",
            price: "0", // user must set the carried cost basis at confirm
            fees: "0",
            confidence: 0.5, // prompts review; sub-1 surfaces in import-review.tsx
          };
        }
      } else {
        // DIVIDEND_OPTION / DIVIDEND_REINVESTMENT: reinvested income, not a contribution.
        candidate = {
          ...base,
          ...instrument,
          action: "bonus",
          quantity: formatDecimal(Math.abs(shares)),
          unit: "shares",
          price: "0",
          fees: "0",
        };
      }
    } else if (UNSUPPORTED.has(type)) {
      fail(`${type}: ${UNSUPPORTED.get(type)}`);
      continue;
    } else {
      // An unrecognised type — don't guess its economics, but don't discard it either.
      // Surface it as a mappable "attention" issue so the user can turn it into the right
      // transaction in the review screen (reusing the Trade Republic map-issue editor).
      // `eventId` mirrors the `tr-csv:${txId}` externalId convention so a mapped row dedups
      // consistently with the rows we parsed directly; a blank txId gets a stable row id.
      const txId = get(cols.txId).trim();
      errors.push({
        line: i + 1,
        severity: "attention",
        eventId: txId ? `tr-csv:${txId}` : `tr-csv:row-${i}`,
        eventType: type || "(blank)",
        message: `unsupported Trade Republic type: ${type || "(blank)"} — review to map manually`,
        raw: {
          isin: isin ?? null,
          name: name ?? null,
          currency: base.currency,
          executedAt: base.executedAt || null,
          amount,
          shares,
        },
      });
      continue;
    }

    const pe: ParserError[] = [];
    tryAddDraft(parsedTransactionSchema, candidate, drafts, pe);
    for (const e of pe) {
      errors.push({ line: i + 1, message: e.issues[0]?.message ?? "invalid row" });
    }
  }

  // Collapse perk-funded buys (STOCKPERK/KINDERGELD_BONUS/BONUS + the same-day buy they fund)
  // into a single `bonus` free-share row. Runs over the full batch since it pairs two rows.
  return { drafts: collapsePerkFundedAcquisitions(drafts), errors };
}

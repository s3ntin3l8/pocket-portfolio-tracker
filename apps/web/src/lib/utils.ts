import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Anomaly } from "@portfolio/api-client";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Locale-aware money formatting (tabular figures rendered via the mono font). */
export function formatMoney(
  amount: number,
  currency = "IDR",
  locale = "en",
  opts: Intl.NumberFormatOptions = {},
) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "IDR" ? 0 : 2,
    ...opts,
  }).format(amount);
}

/**
 * The ONE formatter for a scope's headline net-worth figure (hero, Holdings rail, sidebar).
 * Takes the API's Decimal string and always renders full precision for the currency, so no
 * surface can round differently from another ("€39,045.00" vs "€39,044.83", audit G2).
 */
export function formatNetWorth(netWorth: string | number, currency = "IDR", locale = "en") {
  return formatMoney(Number(netWorth), currency, locale);
}

/**
 * Money formatter that abbreviates large values with locale-aware compact notation
 * ("€1.25M", "Rp 1,25 jt") so they fit tight spots like the forecast scenario chips,
 * while values below `threshold` stay fully precise. Default threshold: 1,000,000.
 */
export function formatMoneyCompact(
  amount: number,
  currency = "IDR",
  locale = "en",
  threshold = 1_000_000,
) {
  if (Math.abs(amount) >= threshold) {
    return formatMoney(amount, currency, locale, {
      notation: "compact",
      maximumFractionDigits: 2,
    });
  }
  return formatMoney(amount, currency, locale);
}

/** A loosely-typed next-intl translator scoped to the `Anomalies` namespace. The dynamic
 *  `codes.<code>` key can't be statically verified, so callers pass `ta` cast to this shape. */
const RECONCILIATION_CODES = new Set([
  "reconciliation_gap",
  "reconciliation_drift",
  "position_gap",
]);

/**
 * Display values for the broker-reconciliation messages. The API hands these over as raw
 * decimal strings (a derived cash figure can carry a dozen digits), so cash amounts render
 * as money in their currency and position quantities as plain numbers (up to 6 dp, trailing
 * zeros trimmed). A position gap names the instrument when the API resolved it, else the ISIN.
 */
function reconciliationValues(
  code: string,
  meta: Record<string, unknown>,
  locale: string,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) values[key] = String(value);
  const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  if (code === "position_gap") {
    const qty = new Intl.NumberFormat(locale, { maximumFractionDigits: 6 });
    for (const key of ["reported", "derived", "diff"]) {
      const n = num(meta[key]);
      if (n != null) values[key] = qty.format(n);
    }
    const isin = String(meta.isin ?? "");
    values.instrument = meta.symbol ? `${String(meta.symbol)} · ${isin}` : isin || "—";
    return values;
  }
  const currency = String(meta.currency ?? "");
  for (const key of ["reported", "derived", "diff", "driftSincePrev"]) {
    const n = num(meta[key]);
    if (n != null) values[key] = formatMoney(n, currency, locale);
  }
  return values;
}

export type AnomalyTranslator = (key: string, values?: Record<string, string>) => string;

/**
 * Localized label/tooltip for a transaction-scoped anomaly. For `negative_cash` it folds the
 * formatted cash balance (and its currency) into the message; `reconciliation_gap`,
 * `reconciliation_drift` and `position_gap` interpolate their raw `meta` fields (currency/isin,
 * reported, derived, …) as-is — every other code uses the bare localized string. Shared by the
 * transactions table tooltip and the detail sheet.
 */
export function anomalyLabel(
  anomaly: { code: string; meta?: Record<string, unknown> | null },
  ta: AnomalyTranslator,
  locale: string,
): string {
  if (anomaly.code === "negative_cash" && anomaly.meta) {
    const currency = String(anomaly.meta.currency ?? "");
    return ta("codes.negative_cash", {
      currency,
      balance: formatMoney(Number(anomaly.meta.balance), currency, locale),
    });
  }
  if (anomaly.meta && RECONCILIATION_CODES.has(anomaly.code)) {
    return ta(`codes.${anomaly.code}`, reconciliationValues(anomaly.code, anomaly.meta, locale));
  }
  if (anomaly.meta) {
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(anomaly.meta)) {
      values[key] = String(value);
    }
    return ta(`codes.${anomaly.code}`, values);
  }
  return ta(`codes.${anomaly.code}`);
}

/**
 * Whether an anomaly attaches to a visible transaction row. This is the ONE partition that
 * must agree everywhere an anomaly count or filter is shown: a `transactionId`-bearing
 * anomaly (missing_transfer_basis, oversell, negative_cash, …) can become a flagged row and
 * be found via "Show flagged only"; a portfolio-scoped one (reconciliation_gap,
 * reconciliation_drift, position_gap) never can — it has nowhere to attach — and must be
 * rendered as its own standalone banner instead. Deliberately keyed on `transactionId`
 * rather than a hardcoded code list: a `negative_cash` whose transactionId happens to be
 * undefined (no matching cash-flow row that day) is just as unfindable as a row and must
 * fall into the same "banner" bucket, or it's counted nowhere and shown nowhere.
 */
export function isRowAnomaly(a: { transactionId?: string }): boolean {
  return Boolean(a.transactionId);
}

/**
 * The headline "N data warnings/errors found" count — and ONLY this count, everywhere it's
 * shown — so it always equals what "Show flagged only" can actually surface. Dedupes to one
 * anomaly per transaction (worst severity wins), matching the row-lookup map every caller
 * already builds for its own flagged-row filter.
 */
export function rowAnomalyCounts(anomalies: Anomaly[]): { errors: number; warnings: number } {
  const byTxId = new Map<string, Anomaly>();
  for (const a of anomalies) {
    if (!isRowAnomaly(a)) continue;
    const id = a.transactionId as string;
    const existing = byTxId.get(id);
    if (!existing || (existing.severity === "warning" && a.severity === "error")) {
      byTxId.set(id, a);
    }
  }
  let errors = 0;
  let warnings = 0;
  for (const a of byTxId.values()) {
    if (a.severity === "error") errors++;
    else warnings++;
  }
  return { errors, warnings };
}

/**
 * Anomalies with nowhere to attach as a row — always render these as their own standalone
 * banner (e.g. ReconciliationBanner), never fold them into the row-count headline.
 */
export function bannerAnomalies<T extends { transactionId?: string }>(anomalies: T[]): T[] {
  return anomalies.filter((a) => !isRowAnomaly(a));
}

/**
 * Money with an explicit leading "+" for non-negatives (negatives already carry "−"),
 * mirroring the signed style of formatPercent. Zero is rendered as "+0".
 */
export function formatSignedMoney(
  amount: number,
  currency = "IDR",
  locale = "en",
  opts: Intl.NumberFormatOptions = {},
) {
  return `${amount >= 0 ? "+" : ""}${formatMoney(amount, currency, locale, opts)}`;
}

/** Semantic text tone for a signed P&L figure: gain green, loss red, zero/unknown neutral. */
export function signTone(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "text-success" : "text-destructive";
}

/**
 * Locale-formatted quantity. Reference (`Pocket Prototype.dc.html`) renders bare numbers
 * for "shares"/"units" with no suffix, and only "grams" gets a short unit ("8 g") — not
 * the generic "shares"/"units" schema word appended to every row.
 */
export function formatQuantity(quantity: number, unit: string | null | undefined, locale = "en") {
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(quantity);
  return unit === "grams" ? `${n} g` : n;
}

export function formatPercent(value: number, locale = "en") {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(value);
}

/**
 * Locale-formatted percentage from a value already expressed in percent points
 * (`12.5` -> "12.5%" / "12,5 %"). Use instead of `x.toFixed(1) + "%"`, which hard-codes
 * the decimal separator and the sign/space convention.
 */
export function formatPercentPoints(pct: number, locale = "en", digits = 1) {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(pct / 100);
}

/** Locale-formatted plain number with a fixed number of decimals (percentage-point gaps, …). */
export function formatFixed(value: number, locale = "en", digits = 1) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Human-readable byte size with a locale-formatted number ("1.5 KB" / "1,5 KB"). The
 * unit symbols (B/KB/MB/GB) are language-neutral, so only the number needs the locale.
 */
export function formatBytes(bytes: number, locale = "en"): string {
  const fmt = (n: number, digits: number) =>
    new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  if (bytes < 1024) return `${fmt(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024, 1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${fmt(bytes / (1024 * 1024), 1)} MB`;
  return `${fmt(bytes / (1024 * 1024 * 1024), 2)} GB`;
}

/** Locale-formatted plain ratio (PE, beta, …) — unsigned, 1-2 decimals. */
export function formatRatio(value: number, locale = "en") {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(value);
}

export interface ReconciliationItem {
  key: string;
  title: string;
  detail: string;
  tag: string;
  dismissLabel: string;
  /** Where to go to look at / fix the gap — omitted when the target isn't known. */
  action?: { href: string; label: string };
}

/**
 * One standalone broker-reconciliation banner (cash or position gap), fully resolved so it
 * can be rendered from a server or client component. A position gap says so (not "Cash
 * doesn't reconcile") and links to the instrument when the API resolved it; a cash gap links
 * to the portfolio's settings, where the broker connection lives. `fallbackPortfolioId`
 * covers single-portfolio callers for anomalies without a `portfolioId` in their meta.
 */
export function reconciliationItem(
  a: { code: string; meta?: Record<string, unknown> | null },
  ta: AnomalyTranslator,
  locale: string,
  fallbackPortfolioId?: string,
): ReconciliationItem {
  const meta = a.meta ?? {};
  const isPosition = a.code === "position_gap";
  const portfolioId = typeof meta.portfolioId === "string" ? meta.portfolioId : fallbackPortfolioId;
  // Same code+subject can occur once per portfolio in the aggregate view.
  const key = [a.code, meta.currency ?? meta.isin ?? "", portfolioId ?? ""].join(":");
  let action: ReconciliationItem["action"];
  if (isPosition && typeof meta.instrumentId === "string") {
    action = { href: `/instruments/${meta.instrumentId}`, label: ta("viewHolding") };
  } else if (!isPosition && portfolioId) {
    action = { href: `/settings/portfolios/${portfolioId}`, label: ta("openConnection") };
  }
  return {
    key,
    title: ta(isPosition ? "reconciliationPositionTitle" : "reconciliationTitle"),
    detail: anomalyLabel(a, ta, locale),
    tag: ta("portfolioTag"),
    dismissLabel: ta("dismiss"),
    action,
  };
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle } from "lucide-react";
import type {
  ApiClient,
  GoldSource,
  Instrument,
  InstrumentSearchResult,
} from "@portfolio/api-client";
import { Input } from "@/components/ui/input";
import { TransactionSourcesSection } from "@/components/transaction-sources-section";
import { useFocusScroll } from "@/lib/use-focus-scroll";
import { useSheetFooter } from "@/components/ui/sheet";
import { TypeChipPicker } from "./add-transaction-form/type-chip-picker";
import { InstrumentField } from "./add-transaction-form/instrument-field";
import { PricingFields } from "./add-transaction-form/pricing-fields";
import { AdvancedFields } from "./add-transaction-form/advanced-fields";
import { SubmitButton } from "./add-transaction-form/submit-button";
import { Field } from "./add-transaction-form/field";
import { isTradeType, isShareReceiptType, isTransferType } from "@portfolio/core";

/** The slice of the API client this form needs (injectable for tests). */
export type AddTransactionClient = Pick<
  ApiClient,
  | "searchInstruments"
  | "lookupInstruments"
  | "createInstrument"
  | "createTransaction"
  | "updateTransaction"
  | "getGoldSources"
>;

/** Prefill values when editing an existing transaction. */
export interface AddTransactionInitial {
  type: string;
  instrumentId: string | null;
  instrument: {
    symbol: string;
    name: string;
    assetClass: string;
    unit: string;
  } | null;
  quantity: string;
  price: string;
  fees: string;
  tax?: string | null;
  fxRate?: string | null;
  /** Dividend/coupon per-share rate + shares paid on (income rows only, #508). */
  perShare?: string | null;
  shares?: string | null;
  nativeCurrency?: string | null;
  grossNative?: string | null;
  description?: string | null;
  tags?: string[] | null;
  currency: string;
  executedAt: string;
  /** Source-provenance rows for this transaction (#230). Present only when editing. */
  sources?: import("@portfolio/api-client").SourceSummary[];
  /** True when at least one source has per-component taxComponents (#230). */
  hasFullTaxDetail?: boolean;
  /** Sub-type (saveback / roundup / transfer_in / merger); null when not set. */
  kind?: string | null;
  /** Original import source (pytr / csv / pdf / screenshot); null = manual. Preserved on edit. */
  source?: string | null;
  /** Import dedup key; null for manual transactions. Preserved on edit. */
  externalId?: string | null;
}

/**
 * Types offered in the dropdown, grouped by behaviour:
 *   Acquisition  — carry instrument + quantity + price/unit + fees + tax
 *   ShareReceipt — carry instrument + quantity + price/unit (not required); no fees/tax
 *   Income       — carry instrument + amount; no quantity/fees; tax retained
 *   Cash         — amount only; no instrument, quantity, fees
 *
 * loan_drawdown / loan_repayment are intentionally excluded: they require a loanId the
 * form cannot set; orphaned legs break loanBalances in core.
 */
const ACQUISITION_TYPES = ["buy", "sell", "savings_plan"] as const;
const SHARE_RECEIPT_TYPES = ["bonus", "split", "rights"] as const;
const INCOME_TYPES = ["dividend", "coupon"] as const;
const CASH_TYPES = [
  "deposit",
  "withdrawal",
  "fee",
  "tax",
  "interest",
  "bonus_cash",
  // Manual signed cash true-up — unlike every other cash type, the sign comes from the
  // user's input (not derived from `type`), so it needs its own amount hint below.
  "adjustment",
] as const;
// First-class transfer types (depot-to-depot, PR #309). Cash-neutral; price = carried basis.
const TRANSFER_TYPES = ["transfer_in", "transfer_out"] as const;

/** Types the user can freely select (the chip palette groups). Loan types are excluded. */
type SelectableType =
  | (typeof ACQUISITION_TYPES)[number]
  | (typeof SHARE_RECEIPT_TYPES)[number]
  | (typeof TRANSFER_TYPES)[number]
  | (typeof INCOME_TYPES)[number]
  | (typeof CASH_TYPES)[number];

/** All recognised types (superset; covers loan rows already in the DB). */
type TxType = SelectableType | "loan_drawdown" | "loan_repayment";
const ASSET_CLASSES = ["equity", "gold", "bond", "mutual_fund", "etf", "crypto"] as const;

/** Gold → buyback market, crypto → CRYPTO, everything else IDX (mirrors the API). */
function marketForAssetClass(assetClass: string): string {
  if (assetClass === "gold") return "ANTAM";
  if (assetClass === "crypto") return "CRYPTO";
  return "IDX";
}

/** Narrow a discovered asset class to one the form's picker offers (else equity). */
function clampAssetClass(value: string): (typeof ASSET_CLASSES)[number] {
  return (ASSET_CLASSES as readonly string[]).includes(value)
    ? (value as (typeof ASSET_CLASSES)[number])
    : "equity";
}

/** Default the unit from the asset class (gold by the gram, funds/crypto by the unit). */
function unitForClass(assetClass: string): "shares" | "grams" | "units" {
  if (assetClass === "gold") return "grams";
  if (assetClass === "mutual_fund" || assetClass === "crypto") return "units";
  return "shares";
}

/**
 * Derive a grouping symbol for a gold position from its label. Gold has no ticker — the
 * label (e.g. "Antam 5g bar") plus the source's market identify the holding, so a labelled
 * position gets its own instrument. Falls back to "GOLD" when no label is given.
 */
function goldSymbolFromLabel(label: string): string {
  const slug = label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "GOLD";
}

export function AddTransactionForm({
  client,
  portfolioId,
  initial,
  transactionId,
  onSuccess,
  stickyFooter = false,
}: {
  client: AddTransactionClient;
  portfolioId: string;
  initial?: AddTransactionInitial;
  transactionId?: string;
  onSuccess?: () => void;
  /** Pin the submit button in a sticky footer bar so it stays visible without scrolling
   *  (#472 — buried below ~10 fields, worse with the mobile keyboard open). Sheet contexts
   *  only: full pages leave this off since a bottom-pinned bar would sit under the fixed
   *  bottom-nav. */
  stickyFooter?: boolean;
}) {
  const t = useTranslations("Manage.tx");
  const tt = useTranslations("TxType");
  const tc = useTranslations("AssetClass");

  const isEdit = Boolean(transactionId);
  const [type, setType] = useState<TxType>(() => (initial?.type as TxType) ?? "buy");
  // Type is chosen from a grouped chip palette (reference), collapsed behind a trigger.
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [kind, setKind] = useState(() => initial?.kind ?? "");
  const [currency, setCurrency] = useState(() => initial?.currency ?? "IDR");
  const [date, setDate] = useState(() => initial?.executedAt?.slice(0, 10) ?? "");
  const [quantity, setQuantity] = useState(() => initial?.quantity ?? "");
  const [price, setPrice] = useState(() => initial?.price ?? "");
  const [fees, setFees] = useState(() => initial?.fees ?? "");
  const [tax, setTax] = useState(() => initial?.tax ?? "");
  const [fxRate, setFxRate] = useState(() => initial?.fxRate ?? "");
  // Dividend/coupon per-share rate + shares paid on (income rows only, #508). Purely
  // informational display fields — never fed into cashflow/holdings/XIRR.
  const [shares, setShares] = useState(() => initial?.shares ?? "");
  const [perShare, setPerShare] = useState(() => initial?.perShare ?? "");
  const [nativeCurrency, setNativeCurrency] = useState(() => initial?.nativeCurrency ?? "");
  const [grossNative, setGrossNative] = useState(() => initial?.grossNative ?? "");
  const [description, setDescription] = useState(() => initial?.description ?? "");
  // Tags stored as a comma-separated string in the UI; parsed to string[] on submit.
  const [tags, setTags] = useState(() => initial?.tags?.join(", ") ?? "");

  // Instrument selection (non-cash types). Prefilled from the edited row.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  const [discovered, setDiscovered] = useState<InstrumentSearchResult[]>([]);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState<Instrument | null>(() =>
    initial?.instrument && initial.instrumentId
      ? {
          id: initial.instrumentId,
          isin: null,
          wkn: null,
          symbol: initial.instrument.symbol,
          market: marketForAssetClass(initial.instrument.assetClass),
          assetClass: initial.instrument.assetClass,
          unit: initial.instrument.unit,
          currency: initial.currency,
          name: initial.instrument.name,
        }
      : null,
  );
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState<(typeof ASSET_CLASSES)[number]>("equity");
  const [unit, setUnit] = useState<"shares" | "grams" | "units">("shares");
  // Set when fields were auto-filled from a discovery match: carries the ISIN + WKN +
  // resolved market so they persist on create. Cleared once the user edits the symbol.
  const [isin, setIsin] = useState<string | null>(null);
  const [wkn, setWkn] = useState<string | null>(null);
  const [discoveredMarket, setDiscoveredMarket] = useState<string | null>(null);

  // Gold buyback sources (registry-driven), with the currently selected source's market.
  const [goldSourceList, setGoldSourceList] = useState<GoldSource[]>([]);
  const [goldMarket, setGoldMarket] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Grouped type chips for the picker palette (reference: Trade / Share receipt /
  // Transfer / Income / Cash). Loan types stay excluded (not offered in any group).
  const typeGroups: { label: string; items: readonly string[] }[] = [
    { label: t("groupTrade"), items: ACQUISITION_TYPES },
    { label: t("groupShareReceipt"), items: SHARE_RECEIPT_TYPES },
    { label: t("groupTransfer"), items: TRANSFER_TYPES },
    { label: t("groupIncome"), items: INCOME_TYPES },
    { label: t("groupCash"), items: CASH_TYPES },
  ];

  // Per-type field groups — drive which fields are shown and validated.
  const isAcquisition = isTradeType(type);
  const isShareReceipt = isShareReceiptType(type);
  // Transfers: instrument + quantity + carried-cost-basis price. Cash-neutral, no fees/tax.
  const isTransfer = isTransferType(type);
  const isIncome = (INCOME_TYPES as readonly string[]).includes(type);
  const isCash =
    (CASH_TYPES as readonly string[]).includes(type) ||
    type === "loan_drawdown" ||
    type === "loan_repayment";

  /** Shows the instrument picker. */
  const hasInstrument = !isCash;
  /** Shows the quantity field. */
  const showQuantity = isAcquisition || isShareReceipt || isTransfer;
  /** Shows fees (acquisitions only — transfers are typically fee-free). */
  const showFees = isAcquisition;
  /** Shows tax withheld (acquisitions + income). */
  const showTax = isAcquisition || isIncome;
  // Gold gets a dedicated entry flow (source + label, no symbol/search). For an already
  // selected instrument (edit) trust its own class; otherwise the picked asset kind.
  const isGold = hasInstrument && (selected ? selected.assetClass : assetClass) === "gold";

  // Load the selectable gold sources once; default to the first (highest-priority) one.
  useEffect(() => {
    let active = true;
    void client
      .getGoldSources()
      .then((sources) => {
        if (!active) return;
        setGoldSourceList(sources);
        if (sources[0]) setGoldMarket((m) => m || sources[0].market);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [client]);

  function runSearch(q: string) {
    setQuery(q);
    setSelected(null);
    const trimmed = q.trim();
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    if (!trimmed) {
      setResults([]);
      setDiscovered([]);
      return;
    }
    // Local reference data is fast; query it immediately.
    void client
      .searchInstruments(trimmed)
      .then(setResults)
      .catch(() => setResults([]));
    // Market-data discovery hits the network — debounce it.
    lookupTimer.current = setTimeout(() => {
      void client
        .lookupInstruments(trimmed)
        .then(setDiscovered)
        .catch(() => setDiscovered([]));
    }, 300);
  }

  /** Auto-fill the create fields from a market-data match (user can still edit). */
  function prefillFrom(match: InstrumentSearchResult) {
    const ac = clampAssetClass(match.assetClass);
    setSymbol(match.symbol.toUpperCase());
    setName(match.name);
    setAssetClass(ac);
    setUnit(unitForClass(ac));
    setCurrency(match.currency);
    setIsin(match.isin ?? null);
    setWkn(match.wkn ?? null);
    setDiscoveredMarket(match.market || null);
    setQuery("");
    setResults([]);
    setDiscovered([]);
  }

  async function resolveInstrumentId(): Promise<string | null> {
    if (!hasInstrument) return null;
    if (selected) return selected.id;
    if (assetClass === "gold") {
      const label = name.trim();
      const market = goldMarket || goldSourceList[0]?.market || "ANTAM";
      const sourceLabel = goldSourceList.find((s) => s.market === market)?.label;
      const created = await client.createInstrument({
        symbol: goldSymbolFromLabel(label),
        market,
        assetClass: "gold",
        unit: "grams",
        currency,
        name: label || sourceLabel || "Gold",
      });
      return created.id;
    }
    const created = await client.createInstrument({
      symbol: symbol.trim(),
      market: discoveredMarket ?? marketForAssetClass(assetClass),
      assetClass,
      unit,
      currency,
      name: name.trim() || symbol.trim(),
      isin: isin ?? undefined,
      wkn: wkn ?? undefined,
    });
    return created.id;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    // A new non-gold instrument needs a symbol (gold derives one from its label). Catch the
    // empty case here with a clear message instead of letting the API reject it generically.
    if (hasInstrument && !selected && assetClass !== "gold" && !symbol.trim()) {
      setError(t("symbolRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const instrumentId = await resolveInstrumentId();
      const parsedTags = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const payload = {
        type,
        instrumentId,
        quantity: showQuantity ? quantity || "0" : "0",
        price: price || "0",
        fees: showFees ? fees || "0" : "0",
        tax: showTax && tax ? tax : null,
        fxRate: fxRate || null,
        perShare: isIncome && perShare ? perShare : null,
        shares: isIncome && shares ? shares : null,
        nativeCurrency: isIncome && nativeCurrency ? nativeCurrency : null,
        grossNative: isIncome && grossNative ? grossNative : null,
        kind: kind || null,
        description: description.trim() || null,
        tags: parsedTags.length > 0 ? parsedTags : null,
        currency,
        executedAt: new Date(date),
        // Preserve import provenance on edit; new manual rows default to "manual".
        source: (isEdit ? (initial?.source ?? "manual") : "manual") as
          "manual" | "screenshot" | "csv" | "pytr",
        externalId: isEdit ? (initial?.externalId ?? undefined) : undefined,
      };
      if (transactionId) {
        await client.updateTransaction(portfolioId, transactionId, payload);
      } else {
        await client.createTransaction(portfolioId, payload);
      }
      onSuccess?.();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  // Scroll focused fields fully into view when the keyboard opens (#472). The sticky
  // footer's `scroll-mb-24` keeps it from sitting flush against the scroll host's edge
  // once scrolled into view — see `useFocusScroll` for why this is the only mechanism
  // needed (SheetContent's max-height already excludes the keyboard's area).
  const formRef = useRef<HTMLFormElement>(null);
  useFocusScroll(formRef);

  // `stickyFooter` sheet contexts portal the submit button into SheetContent's
  // persistent footer region instead of rendering it inline with `position: sticky`
  // (#472 — see `useSheetFooter`'s doc comment for why sticky doesn't reliably work
  // nested this deep). The button still references this form via `form={formId}` even
  // though it's no longer a DOM descendant — a native, browser-supported association.
  const formId = useId();
  const footerEl = useSheetFooter();

  return (
    <>
      <form ref={formRef} id={formId} onSubmit={submit} className="max-w-lg space-y-5">
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </div>
        )}

        <TypeChipPicker
          type={type}
          typePickerOpen={typePickerOpen}
          typeGroups={typeGroups}
          onSelectType={(ty) => {
            setType(ty as TxType);
            setTypePickerOpen(false);
          }}
          onToggle={() => setTypePickerOpen((o) => !o)}
          t={t}
          tt={tt}
        />

        <InstrumentField
          hasInstrument={hasInstrument}
          selected={selected}
          setSelected={setSelected}
          assetClass={assetClass}
          setAssetClass={(v) => setAssetClass(v as (typeof ASSET_CLASSES)[number])}
          unit={unit}
          setUnit={(v) => setUnit(v as "shares" | "grams" | "units")}
          query={query}
          runSearch={runSearch}
          results={results}
          discovered={discovered}
          onSelectSaved={(i) => {
            setSelected(i);
            setResults([]);
            setDiscovered([]);
          }}
          prefillFrom={prefillFrom}
          symbol={symbol}
          setSymbol={setSymbol}
          name={name}
          setName={setName}
          setIsin={setIsin}
          setDiscoveredMarket={setDiscoveredMarket}
          goldSourceList={goldSourceList}
          goldMarket={goldMarket}
          setGoldMarket={setGoldMarket}
          t={t}
          tc={tc}
        />

        <PricingFields
          type={type}
          isGold={isGold}
          quantity={quantity}
          setQuantity={setQuantity}
          price={price}
          setPrice={setPrice}
          fees={fees}
          setFees={setFees}
          tax={tax}
          setTax={setTax}
          shares={shares}
          setShares={setShares}
          perShare={perShare}
          setPerShare={setPerShare}
          currency={currency}
          setCurrency={setCurrency}
          date={date}
          setDate={setDate}
          t={t}
        />

        <Field label={t("notes")} htmlFor="tx-notes">
          <textarea
            id="tx-notes"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("notesPlaceholder")}
            rows={2}
            // text-base (16px) on mobile avoids iOS/Android zoom-on-focus; text-sm from sm: up.
            className="flex w-full resize-y rounded-[13px] border border-border bg-card px-3.5 py-[13px] text-base font-medium transition-colors placeholder:text-text-3 focus-visible:outline-none focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
          />
        </Field>

        <Field label={t("tags")} htmlFor="tx-tags">
          <Input
            id="tx-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder={t("tagsPlaceholder")}
          />
        </Field>

        <AdvancedFields
          type={type}
          fxRate={fxRate}
          setFxRate={setFxRate}
          kind={kind}
          setKind={setKind}
          nativeCurrency={nativeCurrency}
          setNativeCurrency={setNativeCurrency}
          grossNative={grossNative}
          setGrossNative={setGrossNative}
          t={t}
        />

        {isEdit && (initial?.sources?.length ?? 0) > 0 && (
          <TransactionSourcesSection
            portfolioId={portfolioId}
            txId={transactionId!}
            sources={initial?.sources ?? []}
            hasFullTaxDetail={initial?.hasFullTaxDetail ?? false}
          />
        )}
        {isEdit && !(initial?.hasFullTaxDetail ?? false) && (
          <p className="text-sm text-muted-foreground">{t("enrichHint")}</p>
        )}
      </form>

      <SubmitButton
        busy={busy}
        isEdit={isEdit}
        formId={formId}
        stickyFooter={stickyFooter}
        footerEl={footerEl}
        t={t}
      />
    </>
  );
}

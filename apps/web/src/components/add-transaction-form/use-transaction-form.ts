"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  ApiClient,
  GoldSource,
  LoanOption,
  Instrument,
  InstrumentSearchResult,
  BondCouponRateSchedule,
} from "@portfolio/api-client";
import { apiErrorCode, apiErrorIssues } from "@portfolio/api-client";
import { isTradeType, isShareReceiptType, isTransferType } from "@portfolio/core";
import { clearFieldError, clearFieldErrors, publishFieldErrors } from "@/components/ui/form-field";
import {
  INCOME_TYPES,
  CASH_TYPES,
  ASSET_CLASSES,
  BUCKET_DEFAULT_TYPE,
  BUCKET_TYPES,
  BUCKET_SUBTYPE_LABEL_KEY,
  bucketForType,
  type Bucket,
  type SelectableType,
  type TxType,
  marketForAssetClass,
  clampAssetClass,
  unitForClass,
  goldSymbolFromLabel,
  couponRatePercentToFraction,
} from "./constants";
import {
  EMPTY_RATE_SCHEDULE_DRAFT,
  checkRateScheduleDraft,
  type RateScheduleDraft,
} from "@/lib/bond-rate";

export type { SelectableType, TxType };

export type AddTransactionClient = Pick<
  ApiClient,
  | "searchInstruments"
  | "lookupInstruments"
  | "createInstrument"
  | "createTransaction"
  | "updateTransaction"
  | "getGoldSources"
  | "listLoans"
>;

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
  perShare?: string | null;
  shares?: string | null;
  nativeCurrency?: string | null;
  grossNative?: string | null;
  description?: string | null;
  tags?: string[] | null;
  currency: string;
  executedAt: string;
  sources?: import("@portfolio/api-client").SourceSummary[];
  hasFullTaxDetail?: boolean;
  kind?: string | null;
  source?: string | null;
  externalId?: string | null;
  /** The cicilan loan / schedule installment a `loan_repayment` is linked to. */
  loanId?: string | null;
  installmentN?: number | null;
  /** Attested reinvestment of a dividend. Absent is not attested. */
  idReinvested?: boolean;
}

/** An installment/payoff booked by the schedule itself — its link to the loan is fixed. */
const AUTO_BOOKED_LEG = /^loan:[^:]+:(inst:\d+|payoff)$/;

/**
 * The form's fields: the API's input field name, the ids of the controls that carry the
 * value, and which of them is on screen right now.
 *
 * ONE table for both consumers — the setter that drops a published message and the
 * mapping that publishes it. They drifted apart once: the tax rate is rendered twice
 * (inline for an income, in the extras panel for a sale), and a message published onto
 * the copy that was not on screen reached nobody at all.
 */
type FieldControls = {
  /** The API's input field name (see `transactionInputSchema`). */
  api: string;
  /** Every control id of the field — the setter drops the message on all of them. */
  ids: readonly string[];
  /**
   * The control a message for this field belongs to: the one that is on screen.
   * `null` when the form has no visible control for the field — the message then falls
   * back to the generic banner instead of disappearing.
   */
  visible: (shown: ShownControls) => string | null;
};

/** The controls the form shows right now — what a field's visibility depends on. */
type ShownControls = {
  quantity: boolean;
  fees: boolean;
  tax: boolean;
  inlineTax: boolean;
};

const FIELD_CONTROLS: Record<string, FieldControls> = {
  kind: { api: "kind", ids: ["tx-sub-type"], visible: () => "tx-sub-type" },
  currency: { api: "currency", ids: ["tx-currency"], visible: () => "tx-currency" },
  date: { api: "executedAt", ids: ["tx-date"], visible: () => "tx-date" },
  quantity: {
    api: "quantity",
    ids: ["tx-qty"],
    visible: (shown) => (shown.quantity ? "tx-qty" : null),
  },
  price: { api: "price", ids: ["tx-price"], visible: () => "tx-price" },
  fees: { api: "fees", ids: ["tx-fees"], visible: (shown) => (shown.fees ? "tx-fees" : null) },
  tax: {
    api: "tax",
    ids: ["tx-tax", "tx-tax-extra"],
    // The tax rate is rendered twice: inline for an income, in the extras panel for a
    // sale. A type that withholds no tax (a deposit) has neither — and a message for a
    // control that does not exist would reach nobody while the banner is suppressed.
    visible: (shown) => (shown.inlineTax ? "tx-tax" : shown.tax ? "tx-tax-extra" : null),
  },
  fxRate: { api: "fxRate", ids: ["tx-fx-rate"], visible: () => "tx-fx-rate" },
  shares: { api: "shares", ids: ["tx-shares"], visible: () => "tx-shares" },
  perShare: { api: "perShare", ids: ["tx-per-share"], visible: () => "tx-per-share" },
  nativeCurrency: {
    api: "nativeCurrency",
    ids: ["tx-native-currency"],
    visible: () => "tx-native-currency",
  },
  grossNative: {
    api: "grossNative",
    ids: ["tx-gross-native"],
    visible: () => "tx-gross-native",
  },
  description: { api: "description", ids: ["tx-notes"], visible: () => "tx-notes" },
  tags: { api: "tags", ids: ["tx-tags"], visible: () => "tx-tags" },
  loanId: { api: "loanId", ids: ["tx-loan"], visible: () => "tx-loan" },
  installmentN: { api: "installmentN", ids: ["tx-installment"], visible: () => "tx-installment" },
};

/** The API's input field name → the field's control mapping. */
const CONTROL_BY_API_FIELD = new Map(
  Object.entries(FIELD_CONTROLS).map(([, field]) => [field.api, field]),
);

export function useTransactionForm({
  client,
  portfolioId,
  initial,
  transactionId,
  onSuccess,
}: {
  client: AddTransactionClient;
  portfolioId: string;
  initial?: AddTransactionInitial;
  transactionId?: string;
  onSuccess?: () => void;
}) {
  const t = useTranslations("Manage.tx");
  const tt = useTranslations("TxType");
  const tc = useTranslations("AssetClass");
  // The floating-rate schedule strings live in their own namespace so the create form
  // and the admin instrument-edit dialog share one set of labels.
  const tb = useTranslations("BondTerms");

  const isEdit = Boolean(transactionId);
  const [type, setType] = useState<TxType>(() => (initial?.type as TxType) ?? "buy");
  // The bucket switcher's active pill. A legacy share-receipt type (bonus/split/rights —
  // no longer creatable here, see `SHARE_RECEIPT_TYPES`) maps to no bucket; the switcher
  // then shows none active, but the amount/details fields still render correctly for
  // editing that existing transaction (`showQuantity` etc. don't depend on `bucket`).
  const [bucket, setBucketState] = useState<Bucket | null>(() =>
    // A fresh form defaults to Trade/Buy; an edit of an existing legacy share-receipt
    // type (no longer creatable — see `SHARE_RECEIPT_TYPES`) maps to no bucket at all.
    initial ? bucketForType(initial.type) : "trade",
  );
  const [kind, setKind] = useState(() => initial?.kind ?? "");
  // Linking a manual loan repayment to a cicilan loan (and optionally one installment).
  const [loans, setLoans] = useState<LoanOption[] | null>(null);
  const [loanId, setLoanIdState] = useState(() => initial?.loanId ?? "");
  const [installmentN, setInstallmentN] = useState<number | null>(
    () => initial?.installmentN ?? null,
  );
  const [currency, setCurrency] = useState(() => initial?.currency ?? "IDR");
  const [date, setDate] = useState(() => initial?.executedAt?.slice(0, 10) ?? "");
  const [quantity, setQuantity] = useState(() => initial?.quantity ?? "");
  const [price, setPrice] = useState(() => initial?.price ?? "");
  const [fees, setFees] = useState(() => initial?.fees ?? "");
  const [tax, setTax] = useState(() => initial?.tax ?? "");
  const [fxRate, setFxRate] = useState(() => initial?.fxRate ?? "");
  const [shares, setShares] = useState(() => initial?.shares ?? "");
  const [perShare, setPerShare] = useState(() => initial?.perShare ?? "");
  const [nativeCurrency, setNativeCurrency] = useState(() => initial?.nativeCurrency ?? "");
  const [grossNative, setGrossNative] = useState(() => initial?.grossNative ?? "");
  const [description, setDescription] = useState(() => initial?.description ?? "");
  const [tags, setTags] = useState(() => initial?.tags?.join(", ") ?? "");
  const [idReinvested, setIdReinvested] = useState(() => initial?.idReinvested ?? false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  const [discovered, setDiscovered] = useState<InstrumentSearchResult[]>([]);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clear the pending lookup when the form goes away: a debounce that outlives the
  // component fires into a torn-down environment and updates state on a component that
  // is gone (see `useTimeout` for the same guard in hook form).
  //
  // The flag covers the other half: a lookup that is already in flight resolves after
  // the form is gone, and its continuation would update state on a component that is
  // no longer there.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (lookupTimer.current) clearTimeout(lookupTimer.current);
      lookupTimer.current = null;
    };
  }, []);
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
  const [isin, setIsin] = useState<string | null>(null);
  const [wkn, setWkn] = useState<string | null>(null);
  const [discoveredMarket, setDiscoveredMarket] = useState<string | null>(null);

  const [goldSourceList, setGoldSourceList] = useState<GoldSource[]>([]);
  const [goldMarket, setGoldMarket] = useState("");

  // Bond terms, custom-instrument path only. `couponRatePercent` is percent-in
  // ("6.35") — resolveInstrumentId divides by 100 before sending `couponRate` (a
  // fraction, matching the stored/rendered convention elsewhere in the app).
  const [faceValue, setFaceValue] = useState("");
  const [couponRatePercent, setCouponRatePercent] = useState("");
  const [couponSchedule, setCouponSchedule] = useState("monthly");
  const [maturityDate, setMaturityDate] = useState("");
  // Floating-rate bonds (Indonesian retail SBR/ST): the coupon rate RESETS every few
  // months while the payments stay monthly. The rate schedule is a separate axis from
  // `couponSchedule` and replaces the flat `couponRate` when it is filled in.
  const [floatingRate, setFloatingRate] = useState(false);
  const [rateSchedule, setRateSchedule] = useState<RateScheduleDraft>({
    ...EMPTY_RATE_SCHEDULE_DRAFT,
    periods: [],
  });

  // "Can't find it? Add a custom instrument" collapsible (instrument-field.tsx) — closed
  // by default, per the v2 design; opened automatically when editing an existing
  // transaction whose instrument was never resolved to a saved/discovered match.
  const [customOpen, setCustomOpen] = useState(() => Boolean(!initial?.instrumentId && initial));
  // "Add fees / tax" collapsible (pricing-fields.tsx) — closed by default, opened
  // automatically in edit mode when the transaction already carries a nonzero fee or tax
  // so editing doesn't hide already-filled data behind a click.
  const [extrasOpen, setExtrasOpen] = useState(
    () =>
      Boolean(initial?.fees && initial.fees !== "0") ||
      Boolean(initial?.tax && initial.tax !== "0"),
  );
  const [advancedOpen, setAdvancedOpen] = useState(
    () =>
      Boolean(initial?.fxRate) ||
      Boolean(initial?.kind) ||
      Boolean(initial?.shares) ||
      Boolean(initial?.perShare) ||
      Boolean(initial?.nativeCurrency) ||
      Boolean(initial?.grossNative),
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The published field messages belong to this form instance — drop them when it goes.
  useEffect(() => () => clearFieldErrors(), []);

  /**
   * The field setters the form exposes. Each one also drops the validation message
   * published for that field: the user is on it, and a stale "invalid" message under a
   * corrected value is worse than no message at all.
   *
   * They are built ONCE: the raw `useState` setters are stable and the id lists are
   * module constants, so the wrappers keep their identity between renders — a child
   * effect keyed on one of them does not re-run on every render.
   */
  const fieldSetters = useMemo(() => {
    const wrap = (ids: readonly string[], set: (value: string) => void) => (value: string) => {
      set(value);
      for (const id of ids) clearFieldError(id);
    };
    return {
      setKind: wrap(FIELD_CONTROLS.kind.ids, setKind),
      setCurrency: wrap(FIELD_CONTROLS.currency.ids, setCurrency),
      setDate: wrap(FIELD_CONTROLS.date.ids, setDate),
      setQuantity: wrap(FIELD_CONTROLS.quantity.ids, setQuantity),
      setPrice: wrap(FIELD_CONTROLS.price.ids, setPrice),
      setFees: wrap(FIELD_CONTROLS.fees.ids, setFees),
      setTax: wrap(FIELD_CONTROLS.tax.ids, setTax),
      setFxRate: wrap(FIELD_CONTROLS.fxRate.ids, setFxRate),
      setShares: wrap(FIELD_CONTROLS.shares.ids, setShares),
      setPerShare: wrap(FIELD_CONTROLS.perShare.ids, setPerShare),
      setNativeCurrency: wrap(FIELD_CONTROLS.nativeCurrency.ids, setNativeCurrency),
      setGrossNative: wrap(FIELD_CONTROLS.grossNative.ids, setGrossNative),
      setDescription: wrap(FIELD_CONTROLS.description.ids, setDescription),
      setTags: wrap(FIELD_CONTROLS.tags.ids, setTags),
    };
  }, [
    setKind,
    setCurrency,
    setDate,
    setQuantity,
    setPrice,
    setFees,
    setTax,
    setFxRate,
    setShares,
    setPerShare,
    setNativeCurrency,
    setGrossNative,
    setDescription,
    setTags,
  ]);

  const isTrade = isTradeType(type);
  const isShareReceipt = isShareReceiptType(type);
  const isTransfer = isTransferType(type);
  const isIncome = (INCOME_TYPES as readonly string[]).includes(type);
  const isCash =
    (CASH_TYPES as readonly string[]).includes(type) ||
    type === "loan_drawdown" ||
    type === "loan_repayment";

  const hasInstrument = !isCash;
  const showQuantity = isTrade || isShareReceipt || isTransfer;
  // A loan repayment carries its financing margin (sewa modal) in `fees`.
  const isLoanRepayment = type === "loan_repayment";
  const showFees = isTrade || isLoanRepayment;
  // Add: only a sale or an income event ever withholds tax — a buy never does (v2 design,
  // Add Transaction v2.dc.html: `showTax = type === "sell" || isIncome`). Edit differs —
  // its mock (Edit Transaction v2.dc.html) uses `showTax = isAcq || isIncome`, i.e. a buy
  // being *edited* can also carry a tax value (e.g. correcting an import), so the field
  // shows for any trade, not just a sale.
  const showTax = isEdit ? isTrade || isIncome : type === "sell" || isIncome;
  const isGold = hasInstrument && (selected ? selected.assetClass : assetClass) === "gold";

  // Income tax sits inline in the Amount group; an acquisition's fees/tax sit behind the
  // "Add fees / tax" collapsible (only relevant — i.e. rendered at all — for a trade).
  const showInlineTax = isIncome;
  const relevantExtras = isTrade || isLoanRepayment;
  const showExtrasFields = relevantExtras && extrasOpen;
  const showExtrasBtn = relevantExtras && !extrasOpen;
  const extrasLabelKey = isLoanRepayment
    ? "extrasMargin"
    : showTax
      ? "extrasFeesTax"
      : "extrasFees";
  const feesLabelKey = isLoanRepayment ? "loanMargin" : "fees";

  const subTypeLabelKey = bucket ? BUCKET_SUBTYPE_LABEL_KEY[bucket] : "bucketSubtypeAction";
  const openLoans = (loans ?? []).filter((l) => !l.closedAt);
  // "Loan repayment" is a Cash chip only when there is a loan to link it to (or the row being
  // edited already is one).
  const subTypes: readonly string[] = !bucket
    ? []
    : bucket === "cash" && (openLoans.length > 0 || type === "loan_repayment")
      ? [...BUCKET_TYPES.cash, "loan_repayment"]
      : BUCKET_TYPES[bucket];
  const isLoanRepaymentType = type === "loan_repayment";
  const linkLocked = isEdit && AUTO_BOOKED_LEG.test(initial?.externalId ?? "");
  // The loans list is needed as soon as the Cash bucket is open (it decides the chip).
  const needLoans = bucket === "cash";
  useEffect(() => {
    if (!needLoans || loans !== null) return;
    let live = true;
    client
      .listLoans(portfolioId)
      .then((l) => live && setLoans(l))
      .catch(() => live && setLoans([]));
    return () => {
      live = false;
    };
  }, [needLoans, loans, client, portfolioId]);
  // A loan-linked row can only belong to one loan, which also fixes its currency.
  const selectedLoan = (loans ?? []).find((l) => l.loanId === loanId) ?? null;
  function setLoanId(id: string) {
    setLoanIdState(id);
    setInstallmentN(null);
    clearFieldError("tx-loan");
    clearFieldError("tx-installment");
    const loan = (loans ?? []).find((l) => l.loanId === id);
    if (loan) setCurrency(loan.currency);
  }
  function selectInstallment(n: number | null) {
    setInstallmentN(n);
    clearFieldError("tx-installment");
    const row = selectedLoan?.installments.find((i) => i.n === n);
    // Prefill what the schedule says is due, but never overwrite what the user typed.
    if (row) {
      if (!price) setPrice(row.principal);
      if (!fees) setFees(row.margin);
    }
  }

  function setBucket(next: Bucket) {
    setBucketState(next);
    setType(BUCKET_DEFAULT_TYPE[next]);
  }

  const priceLabel = isTransfer
    ? "transferBasis"
    : isGold && showQuantity
      ? "pricePerGram"
      : showQuantity
        ? "price"
        : (INCOME_TYPES as readonly string[]).includes(type)
          ? "netAmount"
          : "amount";
  const priceHint = isTransfer
    ? "transferBasisHint"
    : type === "adjustment"
      ? "adjustmentHint"
      : null;
  const priceRequired = !isShareReceipt && !isTransfer;

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
    void client
      .searchInstruments(trimmed)
      .then((r) => {
        if (mountedRef.current) setResults(r);
      })
      .catch(() => {
        if (mountedRef.current) setResults([]);
      });
    lookupTimer.current = setTimeout(() => {
      void client
        .lookupInstruments(trimmed)
        .then((r) => {
          if (mountedRef.current) setDiscovered(r);
        })
        .catch(() => {
          if (mountedRef.current) setDiscovered([]);
        });
    }, 300);
  }

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
    // Deliberate deviation from the v2 design's own demo state machine (which leaves this
    // collapsed): the prefilled symbol/name/currency fields live behind it, so leaving it
    // closed would silently hide what was just auto-filled.
    setCustomOpen(true);
  }

  function handleSelectSaved(instrument: Instrument) {
    setSelected(instrument);
    setResults([]);
    setDiscovered([]);
  }

  // A floating-rate schedule is only ever SENT when a NEW instrument is created from the
  // custom panel. A picked, already-saved instrument keeps the schedule it was created
  // with, and a cash transaction carries none — so on those paths the draft is
  // irrelevant and must not block an ordinary trade. The guard below has to ask the
  // same question the payload does.
  const createsBondWithSchedule =
    hasInstrument && !selected && assetClass === "bond" && floatingRate;

  async function resolveInstrumentId(
    bondSchedule?: BondCouponRateSchedule,
  ): Promise<string | null> {
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
      ...(assetClass === "bond"
        ? {
            faceValue: faceValue.trim() || undefined,
            // A floating-rate bond carries its rate in the schedule, not in a single
            // `couponRate` — sending both would leave the flat rate as a stale fallback.
            // The same condition the submit-time guard uses decides this branch, so the
            // payload and the guard can never disagree.
            ...(createsBondWithSchedule
              ? { couponRateSchedule: bondSchedule }
              : { couponRate: couponRatePercentToFraction(couponRatePercent) }),
            couponSchedule: couponSchedule as
              "monthly" | "quarterly" | "semiannual" | "annual" | undefined,
            maturityDate: maturityDate || undefined,
          }
        : {}),
    });
    return created.id;
  }

  /**
   * The API's input field names (see `transactionInputSchema`) → the ids of the form's
   * controls. `null` means the form has no visible control for that field, so its message
   * falls back to the generic banner instead of disappearing.
   */
  function fieldIdFor(apiField: string): string | null {
    const field = CONTROL_BY_API_FIELD.get(apiField);
    if (!field) return null;
    return field.visible({
      quantity: showQuantity,
      fees: showFees,
      tax: showTax,
      inlineTax: showInlineTax,
    });
  }

  /** Open the disclosure that hides an offending field, so its message is visible. */
  function revealField(fieldId: string) {
    if (fieldId === "tx-fees" || fieldId === "tx-tax-extra") {
      setExtrasOpen(true);
      return;
    }
    if (
      fieldId === "tx-fx-rate" ||
      fieldId === "tx-sub-type" ||
      fieldId === "tx-shares" ||
      fieldId === "tx-per-share" ||
      fieldId === "tx-native-currency" ||
      fieldId === "tx-gross-native"
    ) {
      setAdvancedOpen(true);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (hasInstrument && !selected && assetClass !== "gold" && !symbol.trim()) {
      setError(t("symbolRequired"));
      return;
    }
    if (isLoanRepaymentType && !isEdit && !loanId) {
      setError(t("loanRequired"));
      return;
    }
    // A floating-rate bond whose schedule is not filled in yet must not be created:
    // it would carry no rate at all and silently drop out of the income/tax forecast.
    // The editor already shows the reason inline; this is the submit-time guard. The
    // checked schedule is handed to `resolveInstrumentId` below, so the payload is
    // exactly the one the check produced.
    let bondSchedule: BondCouponRateSchedule | undefined;
    if (createsBondWithSchedule) {
      const check = checkRateScheduleDraft(rateSchedule);
      if (!check.ok) {
        setError(tb(`issue.${check.issue}`));
        return;
      }
      bondSchedule = check.schedule;
    }
    setBusy(true);
    setError(null);
    try {
      const instrumentId = await resolveInstrumentId(bondSchedule);
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
        // NOT gated on `showTax`: hiding the tax field for a buy only removes the UI
        // affordance to *set* it — `tax` state is still whatever was loaded from `initial`
        // (untouched, since there's no control to change it while hidden). Gating this on
        // `showTax` would silently null out a legacy buy's already-stored tax value on any
        // unrelated edit (e.g. just changing the quantity) — a real data-loss bug flagged in
        // review. A brand-new transaction's `tax` state starts at `""` regardless, so this
        // still correctly submits `null` for it.
        tax: tax || null,
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
        source: (isEdit ? (initial?.source ?? "manual") : "manual") as
          "manual" | "screenshot" | "csv" | "pytr",
        externalId: isEdit ? (initial?.externalId ?? undefined) : undefined,
        // Only a loan repayment carries a link (the API rejects one on any other type).
        ...(isLoanRepaymentType
          ? { loanId: loanId || null, installmentN: loanId ? installmentN : null }
          : {}),
        // Only a dividend can be the attested reinvestment. Any other type stores false,
        // including a dividend edited into a coupon.
        idReinvested: type === "dividend" && idReinvested,
      };
      if (transactionId) {
        await client.updateTransaction(portfolioId, transactionId, payload);
      } else {
        await client.createTransaction(portfolioId, payload);
      }
      clearFieldErrors();
      onSuccess?.();
    } catch (err) {
      // The API's loan-link rejections (a race with the installment job) get their own message.
      const code = apiErrorCode(err);
      // A validation failure names the offending field per issue — show the API's own
      // message there instead of one generic banner.
      const messages: Record<string, string> = {};
      let unmapped = 0;
      for (const issue of apiErrorIssues(err)) {
        const fieldId = fieldIdFor(issue.path[0] ?? "");
        if (!fieldId) {
          unmapped++;
          continue;
        }
        if (!(fieldId in messages)) messages[fieldId] = issue.message;
      }
      publishFieldErrors(messages);
      for (const fieldId of Object.keys(messages)) revealField(fieldId);
      const hasFieldError = Object.keys(messages).length > 0;
      // The banner stays for failures that are not field-level (network, 5xx, an unknown
      // code) and for issues the form has no control for.
      setError(
        hasFieldError && unmapped === 0
          ? null
          : code && t.has(`loanErrors.${code}`)
            ? t(`loanErrors.${code}`)
            : t("error"),
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    t,
    tt,
    tc,
    tb,
    isEdit,
    type,
    setType,
    bucket,
    setBucket,
    subTypeLabelKey,
    subTypes,
    isLoanRepaymentType,
    linkLocked,
    loans: openLoans,
    selectedLoan,
    loanId,
    setLoanId,
    installmentN,
    selectInstallment,
    kind,
    setKind: fieldSetters.setKind,
    currency,
    setCurrency: fieldSetters.setCurrency,
    date,
    setDate: fieldSetters.setDate,
    quantity,
    setQuantity: fieldSetters.setQuantity,
    price,
    setPrice: fieldSetters.setPrice,
    fees,
    setFees: fieldSetters.setFees,
    tax,
    setTax: fieldSetters.setTax,
    fxRate,
    setFxRate: fieldSetters.setFxRate,
    shares,
    setShares: fieldSetters.setShares,
    perShare,
    setPerShare: fieldSetters.setPerShare,
    nativeCurrency,
    setNativeCurrency: fieldSetters.setNativeCurrency,
    grossNative,
    setGrossNative: fieldSetters.setGrossNative,
    description,
    setDescription: fieldSetters.setDescription,
    tags,
    setTags: fieldSetters.setTags,
    idReinvested,
    setIdReinvested,
    query,
    results,
    discovered,
    selected,
    setSelected,
    symbol,
    setSymbol,
    name,
    setName,
    assetClass,
    setAssetClass,
    unit,
    setUnit,
    isin,
    setIsin,
    discoveredMarket,
    setDiscoveredMarket,
    goldSourceList,
    goldMarket,
    setGoldMarket,
    faceValue,
    setFaceValue,
    couponRatePercent,
    setCouponRatePercent,
    couponSchedule,
    setCouponSchedule,
    maturityDate,
    setMaturityDate,
    floatingRate,
    setFloatingRate,
    rateSchedule,
    setRateSchedule,
    busy,
    error,
    isTrade,
    isShareReceipt,
    isTransfer,
    isIncome,
    isCash,
    hasInstrument,
    showQuantity,
    showFees,
    showTax,
    isGold,
    showInlineTax,
    showExtrasFields,
    showExtrasBtn,
    extrasLabelKey,
    feesLabelKey,
    extrasOpen,
    setExtrasOpen,
    customOpen,
    setCustomOpen,
    advancedOpen,
    setAdvancedOpen,
    priceLabel,
    priceHint,
    priceRequired,
    runSearch,
    prefillFrom,
    handleSelectSaved,
    submit,
  };
}

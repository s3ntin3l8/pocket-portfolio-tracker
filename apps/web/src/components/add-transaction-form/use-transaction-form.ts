"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  ApiClient,
  GoldSource,
  Instrument,
  InstrumentSearchResult,
} from "@portfolio/api-client";
import { isTradeType, isShareReceiptType, isTransferType } from "@portfolio/core";
import {
  ACQUISITION_TYPES,
  SHARE_RECEIPT_TYPES,
  INCOME_TYPES,
  CASH_TYPES,
  TRANSFER_TYPES,
  ASSET_CLASSES,
  type SelectableType,
  type TxType,
  marketForAssetClass,
  clampAssetClass,
  unitForClass,
  goldSymbolFromLabel,
} from "./constants";

export type { SelectableType, TxType };

export type AddTransactionClient = Pick<
  ApiClient,
  | "searchInstruments"
  | "lookupInstruments"
  | "createInstrument"
  | "createTransaction"
  | "updateTransaction"
  | "getGoldSources"
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
}

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

  const isEdit = Boolean(transactionId);
  const [type, setType] = useState<TxType>(() => (initial?.type as TxType) ?? "buy");
  const [typePickerOpen, setTypePickerOpen] = useState(false);
  const [kind, setKind] = useState(() => initial?.kind ?? "");
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
  const [isin, setIsin] = useState<string | null>(null);
  const [wkn, setWkn] = useState<string | null>(null);
  const [discoveredMarket, setDiscoveredMarket] = useState<string | null>(null);

  const [goldSourceList, setGoldSourceList] = useState<GoldSource[]>([]);
  const [goldMarket, setGoldMarket] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const typeGroups: { label: string; items: readonly string[] }[] = [
    { label: t("groupTrade"), items: ACQUISITION_TYPES },
    { label: t("groupShareReceipt"), items: SHARE_RECEIPT_TYPES },
    { label: t("groupTransfer"), items: TRANSFER_TYPES },
    { label: t("groupIncome"), items: INCOME_TYPES },
    { label: t("groupCash"), items: CASH_TYPES },
  ];

  const isAcquisition = isTradeType(type);
  const isShareReceipt = isShareReceiptType(type);
  const isTransfer = isTransferType(type);
  const isIncome = (INCOME_TYPES as readonly string[]).includes(type);
  const isCash =
    (CASH_TYPES as readonly string[]).includes(type) ||
    type === "loan_drawdown" ||
    type === "loan_repayment";

  const hasInstrument = !isCash;
  const showQuantity = isAcquisition || isShareReceipt || isTransfer;
  const showFees = isAcquisition;
  const showTax = isAcquisition || isIncome;
  const isGold = hasInstrument && (selected ? selected.assetClass : assetClass) === "gold";

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
      .then(setResults)
      .catch(() => setResults([]));
    lookupTimer.current = setTimeout(() => {
      void client
        .lookupInstruments(trimmed)
        .then(setDiscovered)
        .catch(() => setDiscovered([]));
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
  }

  function handleSelectSaved(instrument: Instrument) {
    setSelected(instrument);
    setResults([]);
    setDiscovered([]);
  }

  function handleSelectType(ty: string) {
    setType(ty as TxType);
    setTypePickerOpen(false);
  }

  function handleToggleTypePicker() {
    setTypePickerOpen((o) => !o);
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

  return {
    t,
    tt,
    tc,
    isEdit,
    type,
    setType,
    typePickerOpen,
    setTypePickerOpen,
    kind,
    setKind,
    currency,
    setCurrency,
    date,
    setDate,
    quantity,
    setQuantity,
    price,
    setPrice,
    fees,
    setFees,
    tax,
    setTax,
    fxRate,
    setFxRate,
    shares,
    setShares,
    perShare,
    setPerShare,
    nativeCurrency,
    setNativeCurrency,
    grossNative,
    setGrossNative,
    description,
    setDescription,
    tags,
    setTags,
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
    busy,
    error,
    typeGroups,
    isAcquisition,
    isShareReceipt,
    isTransfer,
    isIncome,
    isCash,
    hasInstrument,
    showQuantity,
    showFees,
    showTax,
    isGold,
    runSearch,
    prefillFrom,
    handleSelectSaved,
    handleSelectType,
    handleToggleTypePicker,
    submit,
  };
}

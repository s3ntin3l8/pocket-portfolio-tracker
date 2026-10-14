"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ApiClient, Instrument, InstrumentSearchResult } from "@portfolio/api-client";
import { normalizeDecimal } from "@/components/record-corporate-action/normalize-decimal";

/** The slice of the API client this form needs (injectable for tests). */
export type RecordCorpActionClient = Pick<
  ApiClient,
  "searchInstruments" | "lookupInstruments" | "createCorporateAction" | "createMerger"
>;

export const CA_TYPES = ["split", "bonus", "rights", "merger"] as const;
export type CaType = (typeof CA_TYPES)[number];

export interface UseCorporateActionFormOptions {
  client: RecordCorpActionClient;
  /** Required when type is "merger" (mergers are portfolio-scoped). */
  portfolioId?: string;
  onSuccess?: () => void;
  isAdmin?: boolean;
}

/**
 * State + behaviour of `RecordCorporateActionForm`: the split/bonus/rights
 * fields, the merger fields, the instrument lookup (local search immediately,
 * market-data discovery debounced) and submit validation. The component keeps
 * only layout/portal concerns.
 */
export function useCorporateActionForm({
  client,
  portfolioId,
  onSuccess,
  isAdmin = false,
}: UseCorporateActionFormOptions) {
  const t = useTranslations("CorpAction");
  const [type, setType] = useState<CaType>(isAdmin ? "split" : "merger");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  // Market-data discovery results (not yet in the local DB).
  const [discovered, setDiscovered] = useState<InstrumentSearchResult[]>([]);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [ratio, setRatio] = useState("");
  const [exDate, setExDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Informational notice (not an error) — shown when a market-data hit isn't in any portfolio yet.
  const [info, setInfo] = useState<string | null>(null);

  // Merger-specific state
  const [from, setFrom] = useState<Instrument | null>(null);
  const [to, setTo] = useState<Instrument | null>(null);
  const [outQty, setOutQty] = useState("");
  const [inQty, setInQty] = useState("");
  const [executedAt, setExecutedAt] = useState("");
  const [taxable, setTaxable] = useState(false);
  const [marketValue, setMarketValue] = useState("");

  const isMerger = type === "merger";

  function runSearch(q: string) {
    setQuery(q);
    setSelected(null);
    setInfo(null);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);
    const trimmed = q.trim();
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

  /** Pick a saved (local) search result. */
  function selectResult(i: Instrument) {
    setSelected(i);
    setResults([]);
    setDiscovered([]);
  }

  /**
   * When a discovered (market-data) result is picked, try to resolve it to a
   * local DB instrument via its ISIN or symbol. If found, auto-select it.
   * If not, populate the search field so the user can refine or browse.
   */
  async function selectDiscovered(found: InstrumentSearchResult) {
    const key = found.isin ?? found.symbol;
    try {
      const matches = await client.searchInstruments(key);
      if (matches.length > 0) {
        setSelected(matches[0]);
        setResults([]);
        setDiscovered([]);
        setQuery("");
      } else {
        setQuery(found.symbol);
        setResults([]);
        setDiscovered([]);
        setInfo(t("notInPortfolios", { symbol: found.symbol }));
      }
    } catch {
      setResults([]);
      setDiscovered([]);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    if (isMerger) {
      if (!from || !to) {
        setError(t("mergerNeedInstruments"));
        return;
      }
      if (!portfolioId) {
        setError(t("mergerNeedPortfolio"));
        return;
      }
    } else {
      if (!selected) {
        setError(t("needInstrument"));
        return;
      }
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (isMerger && portfolioId) {
        await client.createMerger(portfolioId, {
          fromInstrumentId: from!.id,
          toInstrumentId: to!.id,
          outQty: normalizeDecimal(outQty),
          inQty: normalizeDecimal(inQty),
          executedAt: new Date(executedAt),
          taxable,
          marketValue: taxable ? normalizeDecimal(marketValue) : undefined,
        });
      } else {
        await client.createCorporateAction({
          instrumentId: selected!.id,
          type,
          ratio: ratio || "1",
          exDate: new Date(exDate),
        });
      }
      onSuccess?.();
    } catch {
      setError(isMerger ? t("mergerError") : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return {
    // shared
    type,
    setType,
    isMerger,
    busy,
    error,
    info,
    submit,
    // split / bonus / rights
    query,
    results,
    discovered,
    selected,
    setSelected,
    ratio,
    setRatio,
    exDate,
    setExDate,
    runSearch,
    selectResult,
    selectDiscovered,
    // merger
    from,
    setFrom,
    to,
    setTo,
    outQty,
    setOutQty,
    inQty,
    setInQty,
    executedAt,
    setExecutedAt,
    taxable,
    setTaxable,
    marketValue,
    setMarketValue,
  };
}

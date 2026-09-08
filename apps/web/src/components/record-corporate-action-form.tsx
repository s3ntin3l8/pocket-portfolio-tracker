"use client";

import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { AlertCircle, Sparkles, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import type { ApiClient, Instrument, InstrumentSearchResult } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/utils";
import { useFocusScroll } from "@/lib/use-focus-scroll";
import { useSheetFooter, useSheetFooterChrome } from "@/components/ui/sheet";

/** The slice of the API client this form needs (injectable for tests). */
export type RecordCorpActionClient = Pick<
  ApiClient,
  "searchInstruments" | "lookupInstruments" | "createCorporateAction" | "createMerger"
>;

const TYPES = ["split", "bonus", "rights", "merger"] as const;
type CaType = (typeof TYPES)[number];

const CARD = "space-y-3.5 rounded-[16px] border border-border bg-card p-4 shadow-card";

/**
 * Accept German-formatted numbers as typed off a DKB document — `"3.869,77"` → `"3869.77"`.
 * A value with a decimal comma has its dot thousands-separators stripped; a plain decimal
 * string passes through.
 */
function normalizeDecimal(raw: string): string {
  const s = raw.trim();
  return s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
}

/** A reusable search-and-select picker for one instrument. */
function InstrumentPicker({
  label,
  placeholder,
  selected,
  onSelect,
  search,
}: {
  label: string;
  placeholder: string;
  selected: Instrument | null;
  onSelect: (i: Instrument | null) => void;
  search: (q: string) => Promise<Instrument[]>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);

  async function runSearch(q: string) {
    setQuery(q);
    onSelect(null);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    try {
      setResults(await search(q.trim()));
    } catch {
      setResults([]);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {selected ? (
        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
          <span>
            <span className="font-medium">{selected.symbol}</span>
            <span className="ml-2 text-muted-foreground">{selected.name}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={placeholder}
            onClick={() => onSelect(null)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <>
          <Input
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder={placeholder}
            aria-label={label}
          />
          {results.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border">
              {results.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(i);
                      setResults([]);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <span className="font-medium">{i.symbol}</span>
                    <span className="text-muted-foreground">{i.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function RecordCorporateActionForm({
  client,
  portfolioId,
  onSuccess,
  stickyFooter = false,
  isAdmin = false,
}: {
  client: RecordCorpActionClient;
  /** Required when type is "merger" (mergers are portfolio-scoped). */
  portfolioId?: string;
  onSuccess?: () => void;
  /** See `AddTransactionForm` — sheet contexts only. */
  stickyFooter?: boolean;
  isAdmin?: boolean;
}) {
  const t = useTranslations("CorpAction");
  const tt = useTranslations("TxType");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Instrument[]>([]);
  // Market-data discovery results (not yet in the local DB).
  const [discovered, setDiscovered] = useState<InstrumentSearchResult[]>([]);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selected, setSelected] = useState<Instrument | null>(null);
  const [type, setType] = useState<CaType>("split");
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

  // Scroll focused fields fully into view when the keyboard opens (#472). See
  // `AddTransactionForm` — same sheet context, same OSK-occlusion risk.
  const formRef = useRef<HTMLFormElement>(null);
  useFocusScroll(formRef);

  // See `AddTransactionForm` for why the submit button portals into SheetContent's
  // footer region instead of using `position: sticky` (#472).
  const formId = useId();
  const footerEl = useSheetFooter();
  const hasFooterChrome = useSheetFooterChrome();
  const useFooterPortal = stickyFooter && footerEl;

  if (!isAdmin) {
    return (
      <div className="rounded-md border border-border bg-muted/40 px-4 py-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">{t("adminOnly")}</p>
      </div>
    );
  }

  return (
    <>
      <form ref={formRef} id={formId} onSubmit={submit} className="space-y-3.5">
        {info && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            {info}
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {/* ── Action type ─────────────────────────────────────────── */}
        <div className={CARD}>
          <Eyebrow>{t("type")}</Eyebrow>
          <div className="space-y-1.5">
            <Select id="ca-type" value={type} onChange={(e) => setType(e.target.value as CaType)}>
              {TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {tt(ty)}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* ── Instrument(s) ────────────────────────────────────────── */}
        <div className={CARD}>
          <Eyebrow>{isMerger ? t("mergerInstruments") : t("instrument")}</Eyebrow>
          {isMerger ? (
            <div className="space-y-3.5">
              <InstrumentPicker
                label={t("mergerFrom")}
                placeholder={t("search")}
                selected={from}
                onSelect={setFrom}
                search={client.searchInstruments}
              />
              <InstrumentPicker
                label={t("mergerTo")}
                placeholder={t("search")}
                selected={to}
                onSelect={setTo}
                search={client.searchInstruments}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              {selected ? (
                <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium">{selected.symbol}</span>
                    <span className="ml-2 text-muted-foreground">{selected.name}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("search")}
                    onClick={() => setSelected(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    value={query}
                    onChange={(e) => runSearch(e.target.value)}
                    placeholder={t("search")}
                    aria-label={t("search")}
                  />
                  {results.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {t("savedResults")}
                      </p>
                      <ul className="divide-y divide-border rounded-md border border-border">
                        {results.map((i) => (
                          <li key={i.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelected(i);
                                setResults([]);
                                setDiscovered([]);
                              }}
                              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                            >
                              <span className="font-medium">{i.symbol}</span>
                              <span className="text-muted-foreground">{i.name}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {discovered.length > 0 && (
                    <div className="space-y-1">
                      <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <Sparkles className="size-3" />
                        {t("discoveredResults")}
                      </p>
                      <ul className="divide-y divide-border rounded-md border border-border">
                        {discovered.map((i) => (
                          <li key={`${i.market}:${i.symbol}:${i.source}`}>
                            <button
                              type="button"
                              onClick={() => void selectDiscovered(i)}
                              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                            >
                              <span className="font-medium">{i.symbol}</span>
                              <span className="truncate text-muted-foreground">{i.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {i.currency}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
              <p className="text-xs text-muted-foreground">
                {selected ? t("scopeHintFor", { symbol: selected.symbol }) : t("scopeHint")}
              </p>
            </div>
          )}
        </div>

        {/* ── Details ───────────────────────────────────────────────── */}
        <div className={CARD}>
          <Eyebrow>{t("details")}</Eyebrow>
          {isMerger ? (
            <div className="space-y-3.5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="merger-out">{t("mergerOutQty")}</Label>
                  <Input
                    id="merger-out"
                    inputMode="decimal"
                    value={outQty}
                    onChange={(e) => setOutQty(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="merger-in">{t("mergerInQty")}</Label>
                  <Input
                    id="merger-in"
                    inputMode="decimal"
                    value={inQty}
                    onChange={(e) => setInQty(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="merger-date">{t("mergerDate")}</Label>
                <DatePicker
                  id="merger-date"
                  label={t("mergerDate")}
                  value={executedAt}
                  onChange={(e) => setExecutedAt(e.target.value)}
                  required
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={taxable}
                  onChange={(e) => setTaxable(e.target.checked)}
                  className="size-4"
                />
                {t("mergerTaxable")}
              </label>
              {taxable && (
                <div className="space-y-1.5">
                  <Label htmlFor="merger-value">{t("mergerMarketValue")}</Label>
                  <Input
                    id="merger-value"
                    inputMode="decimal"
                    value={marketValue}
                    onChange={(e) => setMarketValue(e.target.value)}
                    required
                  />
                  <p className="text-xs text-muted-foreground">{t("mergerMarketValueHint")}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ca-ratio">{t("ratio")}</Label>
                <Input
                  id="ca-ratio"
                  inputMode="decimal"
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground">{t("ratioHint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ca-date">{t("exDate")}</Label>
                <DatePicker
                  id="ca-date"
                  label={t("exDate")}
                  value={exDate}
                  onChange={(e) => setExDate(e.target.value)}
                  required
                />
              </div>
            </div>
          )}
        </div>

        {!useFooterPortal && (
          <div
            className={cn(
              stickyFooter &&
                "sticky bottom-0 -mx-5 border-t border-border bg-background px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] scroll-mb-24",
            )}
          >
            <Button
              type="submit"
              disabled={busy}
              className="h-auto w-full rounded-[15px] py-[15px] text-[15px] font-bold"
            >
              {busy && <Spinner size="sm" />}
              {busy ? t("submitting") : isMerger ? t("mergerSubmit") : t("submit")}
            </Button>
          </div>
        )}
      </form>
      {useFooterPortal &&
        (hasFooterChrome
          ? createPortal(
              <Button
                type="submit"
                form={formId}
                disabled={busy}
                className="h-auto rounded-[13px] px-[26px] py-[13px] text-[14px] font-bold"
              >
                {busy && <Spinner size="sm" />}
                {busy ? t("submitting") : isMerger ? t("mergerSubmit") : t("submit")}
              </Button>,
              footerEl,
            )
          : createPortal(
              <div className="border-t border-border bg-background px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <Button
                  type="submit"
                  form={formId}
                  disabled={busy}
                  className="h-auto w-full rounded-[15px] py-[15px] text-[15px] font-bold"
                >
                  {busy && <Spinner size="sm" />}
                  {busy ? t("submitting") : isMerger ? t("mergerSubmit") : t("submit")}
                </Button>
              </div>,
              footerEl,
            ))}
    </>
  );
}

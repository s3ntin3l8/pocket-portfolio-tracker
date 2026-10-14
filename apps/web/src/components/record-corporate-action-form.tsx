"use client";

import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { AlertCircle, Sparkles, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { PortfolioPicker, type PickablePortfolio } from "@/components/portfolio-picker";
import { cn } from "@/lib/utils";
import { useFocusScroll } from "@/lib/use-focus-scroll";
import { useSheetFooter, useSheetFooterChrome } from "@/components/ui/sheet";
import { Checkbox } from "@/components/ui/checkbox";
import { InstrumentPicker } from "@/components/record-corporate-action/instrument-picker";
import {
  CA_TYPES,
  useCorporateActionForm,
  type CaType,
  type RecordCorpActionClient,
} from "@/components/record-corporate-action/use-corporate-action-form";

export type { RecordCorpActionClient };

export function RecordCorporateActionForm({
  client,
  portfolioId,
  portfolios,
  onPortfolioChange,
  onSuccess,
  stickyFooter = false,
  isAdmin = false,
}: {
  client: RecordCorpActionClient;
  /** Required when type is "merger" (mergers are portfolio-scoped). */
  portfolioId?: string;
  /** Available portfolios for the merger portfolio picker. */
  portfolios?: PickablePortfolio[];
  /** Called when the user picks a different portfolio in the merger picker. Required
   *  when `portfolios` is supplied — without it the picker would silently no-op and
   *  submit would fail `mergerNeedPortfolio` (#719 review). */
  onPortfolioChange: (id: string) => void;
  onSuccess?: () => void;
  /** See `AddTransactionForm` — sheet contexts only. */
  stickyFooter?: boolean;
  isAdmin?: boolean;
}) {
  const t = useTranslations("CorpAction");
  const tt = useTranslations("TxType");
  const tA11y = useTranslations("A11y");
  const {
    type,
    setType,
    isMerger,
    busy,
    error,
    info,
    submit,
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
  } = useCorporateActionForm({ client, portfolioId, onSuccess, isAdmin });

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

  // Mergers are portfolio-scoped transactions (like buy/sell) and don't require admin
  // privileges. Other corporate action types (split/bonus/rights) are instrument-global
  // and require admin.
  const isMergerOnly = !isAdmin && type === "merger";

  if (!isAdmin && type !== "merger") {
    return (
      <div className="rounded-md border border-border bg-muted/40 px-4 py-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">{t("adminOnly")}</p>
      </div>
    );
  }

  return (
    <>
      <form
        ref={formRef}
        id={formId}
        onSubmit={submit}
        className="flex max-w-[600px] flex-col gap-[13px]"
      >
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

        {/* ── Portfolio (merger only) ──────────────────────────────── */}
        {isMerger && portfolios && portfolios.length > 1 && (
          <div className="space-y-1.5">
            <Label>{t("portfolio")}</Label>
            <PortfolioPicker
              portfolios={portfolios}
              value={portfolioId ?? ""}
              onChange={onPortfolioChange}
              ariaLabel={t("portfolio")}
              triggerClassName="w-full sm:max-w-xs"
            />
          </div>
        )}

        {/* ── Action type ─────────────────────────────────────────── */}
        {!isMergerOnly && (
          <div className="space-y-1.5">
            <Label htmlFor="ca-type">{t("type")}</Label>
            <Select id="ca-type" value={type} onChange={(e) => setType(e.target.value as CaType)}>
              {CA_TYPES.map((ty) => (
                <option key={ty} value={ty}>
                  {tt(ty)}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* ── Instrument(s) ────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <Label>{isMerger ? t("mergerInstruments") : t("instrument")}</Label>
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
                    aria-label={tA11y("clearSelection")}
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
                              onClick={() => selectResult(i)}
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
              <Checkbox
                checked={taxable}
                onCheckedChange={(c) => setTaxable(c === true)}
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
              className="h-auto w-full rounded-lg py-[15px] text-body font-bold"
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
                className="h-auto rounded-md px-[26px] py-[13px] text-sm font-bold"
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
                  className="h-auto w-full rounded-lg py-[15px] text-body font-bold"
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

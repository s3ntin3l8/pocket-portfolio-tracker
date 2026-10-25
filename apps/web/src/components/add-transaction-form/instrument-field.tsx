"use client";

import { ChevronDown, Sparkles, X } from "lucide-react";
import type { GoldSource, Instrument, InstrumentSearchResult } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InstrumentLogo } from "@/components/instrument-logo";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { FormField } from "@/components/ui/form-field";
import { unitForClass } from "./constants";
import { BondRateScheduleEditor } from "./bond-rate-schedule-editor";
import type { RateScheduleDraft } from "@/lib/bond-rate";

const ASSET_CLASSES = ["equity", "gold", "bond", "mutual_fund", "etf", "crypto"] as const;
const UNITS = ["shares", "grams", "units"] as const;
const COUPON_SCHEDULES = ["monthly", "quarterly", "semiannual", "annual"] as const;

interface InstrumentFieldProps {
  /** Edit mode only (v2 design): wraps the field in a `bg-card-2` inset box instead of
   *  the plain border-top separator every other section uses. Add mode leaves this off. */
  boxed?: boolean;
  hasInstrument: boolean;
  selected: Instrument | null;
  setSelected: (i: Instrument | null) => void;
  assetClass: string;
  setAssetClass: (v: string) => void;
  unit: string;
  setUnit: (v: string) => void;
  query: string;
  runSearch: (q: string) => void;
  results: Instrument[];
  discovered: InstrumentSearchResult[];
  onSelectSaved: (instrument: Instrument) => void;
  prefillFrom: (match: InstrumentSearchResult) => void;
  symbol: string;
  setSymbol: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  setIsin: (v: string | null) => void;
  setDiscoveredMarket: (v: string | null) => void;
  goldSourceList: GoldSource[];
  goldMarket: string;
  setGoldMarket: (v: string) => void;
  faceValue: string;
  setFaceValue: (v: string) => void;
  couponRatePercent: string;
  setCouponRatePercent: (v: string) => void;
  couponSchedule: string;
  setCouponSchedule: (v: string) => void;
  maturityDate: string;
  setMaturityDate: (v: string) => void;
  /** Floating-rate bond (SBR/ST): the coupon rate resets, the payments don't. */
  floatingRate: boolean;
  setFloatingRate: (v: boolean) => void;
  rateSchedule: RateScheduleDraft;
  setRateSchedule: (v: RateScheduleDraft) => void;
  customOpen: boolean;
  onToggleCustom: () => void;
  t: (key: string) => string;
  tc: (key: string) => string;
  /** Translator for the `BondTerms` namespace (the floating-rate schedule strings). */
  tb: (key: string) => string;
}

/** The v2 design's "Instrument" section. In Add mode there's no enclosing card (just a
 *  border-top separator, matching every other form section); Edit mode additionally
 *  wraps the field in a `bg-card-2` inset box (`boxed` prop) — the two mocks genuinely
 *  differ here, not a style nudge. The custom-entry fields (Kind/Source/Symbol/Name/Unit)
 *  sit behind a "Can't find it? Add a custom instrument" collapsible either way. */
export function InstrumentField({
  boxed = false,
  hasInstrument,
  selected,
  setSelected,
  assetClass,
  setAssetClass,
  unit,
  setUnit,
  query,
  runSearch,
  results,
  discovered,
  onSelectSaved,
  prefillFrom,
  symbol,
  setSymbol,
  name,
  setName,
  setIsin,
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
  customOpen,
  onToggleCustom,
  t,
  tc,
  tb,
}: InstrumentFieldProps) {
  if (!hasInstrument) return null;

  return (
    <div className="border-t border-line pt-[18px]">
      <Label>{t("instrument")}</Label>
      <div
        className={cn(
          "mt-1.5 flex flex-col gap-[13px]",
          boxed && "rounded-lg border border-border bg-card-2 p-[14px]",
        )}
      >
        {selected ? (
          <div className="flex items-center gap-2.5 rounded-md border border-border bg-card px-[11px] py-[9px] text-sm">
            <InstrumentLogo
              label={selected.symbol}
              symbol={selected.symbol}
              market={selected.market}
              assetClass={selected.assetClass}
              className="size-[34px] shrink-0 rounded-sm"
            />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-bold">{selected.symbol}</span>
              <span className="ml-2 text-text-2">{selected.name}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("back")}
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
              <div className="space-y-1.5">
                <p className="text-micro font-semibold text-text-2">{t("savedResults")}</p>
                <ul className="divide-y divide-line rounded-md border border-border bg-card">
                  {results.map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        onClick={() => onSelectSaved(i)}
                        className="flex w-full items-center gap-2.5 px-[11px] py-[9px] text-left text-sm hover:bg-accent"
                      >
                        <InstrumentLogo
                          label={i.symbol}
                          symbol={i.symbol}
                          market={i.market}
                          assetClass={i.assetClass}
                          className="size-8 rounded-sm"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-bold">{i.symbol}</span>
                          <span className="ml-2 text-text-2">{i.name}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {discovered.length > 0 && (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1 text-micro font-semibold text-text-2">
                  <Sparkles className="size-3" />
                  {t("discoveredResults")}
                </p>
                <ul className="divide-y divide-line rounded-md border border-border bg-card">
                  {discovered.map((i) => (
                    <li key={`${i.market}:${i.symbol}:${i.source}`}>
                      <button
                        type="button"
                        onClick={() => prefillFrom(i)}
                        className="flex w-full items-center gap-2.5 px-[11px] py-[9px] text-left text-sm hover:bg-accent"
                      >
                        <InstrumentLogo
                          label={i.symbol}
                          symbol={i.symbol}
                          market={i.market}
                          assetClass={i.assetClass}
                          className="size-8 rounded-sm"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-bold">{i.symbol}</span>
                          <span className="ml-2 text-text-2">{i.name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-text-2">{i.currency}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="button"
              onClick={onToggleCustom}
              aria-expanded={customOpen}
              aria-controls="tx-custom-instrument-panel"
              className="flex items-center gap-1.5 self-start text-xs font-semibold text-primary"
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform", customOpen && "rotate-180")}
                strokeWidth={2.2}
              />
              {t("customInstrumentToggle")}
            </button>

            {/* The panel keeps its node (and its id) whether it is open or not, so
                `aria-controls` always points at an element that exists. */}
            <div id="tx-custom-instrument-panel" className={cn(!customOpen && "hidden")}>
              {customOpen && (
                <div className="flex flex-col gap-[13px] border-t border-line pt-[13px]">
                  <FormField label={t("kind")} id="tx-kind">
                    <Select
                      id="tx-kind"
                      value={assetClass}
                      onChange={(e) => {
                        const ac = e.target.value as (typeof ASSET_CLASSES)[number];
                        setAssetClass(ac);
                        setUnit(unitForClass(ac));
                      }}
                    >
                      {ASSET_CLASSES.map((c) => (
                        <option key={c} value={c}>
                          {tc(c)}
                        </option>
                      ))}
                    </Select>
                  </FormField>

                  {assetClass === "gold" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label={t("goldSource")} id="tx-gold-source">
                        <Select
                          id="tx-gold-source"
                          value={goldMarket}
                          onChange={(e) => setGoldMarket(e.target.value)}
                        >
                          {goldSourceList.map((s) => (
                            <option key={s.market} value={s.market}>
                              {s.label}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField label={t("goldLabel")} id="tx-gold-label">
                        <Input
                          id="tx-gold-label"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder={t("goldLabelPlaceholder")}
                        />
                      </FormField>
                      <p className="col-span-2 text-xs text-text-2">{t("goldNote")}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label={t("symbol")} id="tx-symbol">
                        <Input
                          id="tx-symbol"
                          value={symbol}
                          onChange={(e) => {
                            setSymbol(e.target.value.toUpperCase());
                            setIsin(null);
                            setDiscoveredMarket(null);
                          }}
                        />
                      </FormField>
                      <FormField label={t("name")} id="tx-name">
                        <Input
                          id="tx-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </FormField>
                      <div className="col-span-2">
                        <FormField label={t("unit")} id="tx-unit">
                          <Select
                            id="tx-unit"
                            value={unit}
                            onChange={(e) => setUnit(e.target.value as (typeof UNITS)[number])}
                          >
                            {UNITS.map((u) => (
                              <option key={u} value={u}>
                                {t(`units.${u}`)}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                      </div>

                      {assetClass === "bond" && (
                        <>
                          <FormField label={t("bondFaceValueLabel")} id="tx-bond-face-value">
                            <Input
                              id="tx-bond-face-value"
                              inputMode="decimal"
                              value={faceValue}
                              onChange={(e) => setFaceValue(e.target.value)}
                              placeholder={t("bondFaceValuePlaceholder")}
                            />
                          </FormField>
                          {/* Floating-rate bonds (Indonesian retail SBR/ST) reset their
                            coupon rate every few months while the PAYMENTS stay on the
                            same schedule. The toggle swaps the single rate for a rate
                            schedule — two independent axes, never merged. */}
                          <div className="col-span-2 flex items-start gap-2">
                            <Checkbox
                              id="tx-bond-floating-rate"
                              checked={floatingRate}
                              onCheckedChange={(v) => setFloatingRate(v === true)}
                            />
                            <div className="space-y-0.5">
                              <Label htmlFor="tx-bond-floating-rate" className="text-sm">
                                {tb("floatingRateLabel")}
                              </Label>
                              <p className="text-xs text-text-2">{tb("floatingRateHint")}</p>
                            </div>
                          </div>
                          {!floatingRate && (
                            <FormField label={t("bondCouponRateLabel")} id="tx-bond-coupon-rate">
                              <Input
                                id="tx-bond-coupon-rate"
                                inputMode="decimal"
                                value={couponRatePercent}
                                onChange={(e) => setCouponRatePercent(e.target.value)}
                                placeholder="6.35"
                              />
                            </FormField>
                          )}
                          <FormField label={t("bondCouponSchedule")} id="tx-bond-coupon-schedule">
                            <Select
                              id="tx-bond-coupon-schedule"
                              value={couponSchedule}
                              onChange={(e) => setCouponSchedule(e.target.value)}
                            >
                              {COUPON_SCHEDULES.map((s) => (
                                <option key={s} value={s}>
                                  {t(
                                    `bondSchedule${s.charAt(0).toUpperCase()}${s.slice(1)}` as
                                      | "bondScheduleMonthly"
                                      | "bondScheduleQuarterly"
                                      | "bondScheduleSemiannual"
                                      | "bondScheduleAnnual",
                                  )}
                                </option>
                              ))}
                            </Select>
                          </FormField>
                          <FormField label={t("bondMaturityDate")} id="tx-bond-maturity">
                            <Input
                              id="tx-bond-maturity"
                              type="date"
                              value={maturityDate}
                              onChange={(e) => setMaturityDate(e.target.value)}
                            />
                          </FormField>
                          {floatingRate && (
                            <BondRateScheduleEditor
                              value={rateSchedule}
                              onChange={setRateSchedule}
                              t={tb}
                              idPrefix="tx-bond-rate"
                            />
                          )}
                          <p className="col-span-2 text-xs text-text-2">{t("bondNote")}</p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

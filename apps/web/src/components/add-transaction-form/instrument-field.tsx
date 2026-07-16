"use client";

import { Sparkles, X } from "lucide-react";
import type { GoldSource, Instrument, InstrumentSearchResult } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InstrumentLogo } from "@/components/instrument-logo";
import { Select } from "@/components/ui/select";
import { Field } from "./field";

const ASSET_CLASSES = ["equity", "gold", "bond", "mutual_fund", "etf", "crypto"] as const;
const UNITS = ["shares", "grams", "units"] as const;

interface InstrumentFieldProps {
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
  t: (key: string) => string;
  tc: (key: string) => string;
}

export function InstrumentField({
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
  t,
  tc,
}: InstrumentFieldProps) {
  if (!hasInstrument) return null;

  return (
    <Field label={t("instrument")}>
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        {selected ? (
          <div className="flex items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2 text-sm">
            <InstrumentLogo
              label={selected.symbol}
              symbol={selected.symbol}
              market={selected.market}
              assetClass={selected.assetClass}
              className="size-8 rounded-[9px]"
            />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{selected.symbol}</span>
              <span className="ml-2 text-muted-foreground">{selected.name}</span>
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
            <Field label={t("kind")} htmlFor="tx-kind">
              <Select
                id="tx-kind"
                value={assetClass}
                onChange={(e) => {
                  const ac = e.target.value as (typeof ASSET_CLASSES)[number];
                  setAssetClass(ac);
                  setUnit(
                    ac === "gold"
                      ? "grams"
                      : ac === "mutual_fund" || ac === "crypto"
                        ? "units"
                        : "shares",
                  );
                }}
              >
                {ASSET_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {tc(c)}
                  </option>
                ))}
              </Select>
            </Field>

            {assetClass === "gold" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("goldSource")} htmlFor="tx-gold-source">
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
                </Field>
                <Field label={t("goldLabel")} htmlFor="tx-gold-label">
                  <Input
                    id="tx-gold-label"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("goldLabelPlaceholder")}
                  />
                </Field>
                <p className="text-xs text-muted-foreground sm:col-span-2">{t("goldNote")}</p>
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
                    <p className="text-xs font-medium text-muted-foreground">{t("savedResults")}</p>
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {results.map((i) => (
                        <li key={i.id}>
                          <button
                            type="button"
                            onClick={() => onSelectSaved(i)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent"
                          >
                            <InstrumentLogo
                              label={i.symbol}
                              symbol={i.symbol}
                              market={i.market}
                              assetClass={i.assetClass}
                              className="size-8 rounded-[9px]"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              <span className="font-medium">{i.symbol}</span>
                              <span className="ml-2 text-muted-foreground">{i.name}</span>
                            </span>
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
                            onClick={() => prefillFrom(i)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-accent"
                          >
                            <InstrumentLogo
                              label={i.symbol}
                              symbol={i.symbol}
                              market={i.market}
                              assetClass={i.assetClass}
                              className="size-8 rounded-[9px]"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              <span className="font-medium">{i.symbol}</span>
                              <span className="ml-2 text-muted-foreground">{i.name}</span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {i.currency}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="pt-1 text-xs font-medium text-muted-foreground">
                  {t("newInstrument")}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={t("symbol")} htmlFor="tx-symbol">
                    <Input
                      id="tx-symbol"
                      value={symbol}
                      onChange={(e) => {
                        setSymbol(e.target.value.toUpperCase());
                        setIsin(null);
                        setDiscoveredMarket(null);
                      }}
                    />
                  </Field>
                  <Field label={t("name")} htmlFor="tx-name">
                    <Input id="tx-name" value={name} onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field label={t("unit")} htmlFor="tx-unit">
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
                  </Field>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Field>
  );
}

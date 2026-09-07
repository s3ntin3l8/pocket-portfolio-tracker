"use client";

import { useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Search, X, Sparkles, Plus } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { benchmarkLabel } from "@/lib/benchmark-labels";
import type { BenchmarkSymbolEntry, InstrumentSearchResult } from "@portfolio/api-client";

const MAX = 3;

// Quick-pick indices — `currency` below is a UI-only placeholder; the backend infers the
// real currency from stored benchmark_prices via getUserBenchmarkConfig.
const SUGGESTED = [
  "^GSPC",
  "^DJI",
  "^IXIC",
  "^GDAXI",
  "^N225",
  "^HSI",
  "^JKSE",
  "^STOXX50E",
  "^FTSE",
] as const;

export function EditBenchmarkDialog({
  open,
  onOpenChange,
  currentSymbols,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSymbols: BenchmarkSymbolEntry[];
}) {
  const t = useTranslations("Insights.benchmark");
  const api = useApiClient();
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InstrumentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<BenchmarkSymbolEntry[]>(currentSymbols);
  const [saving, setSaving] = useState(false);

  const runSearch = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) {
        setResults([]);
        return;
      }
      setLoading(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        try {
          const res = await api.lookupInstruments(trimmed);
          setResults(res);
        } catch {
          setResults([]);
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    [api],
  );

  const addSymbol = (sym: string, name?: string | null) => {
    if (list.length >= MAX) return;
    if (list.some((s) => s.symbol === sym)) return;
    setList((prev) => [
      ...prev,
      { symbol: sym, displayName: name?.trim() || benchmarkLabel(sym), displayOrder: prev.length },
    ]);
  };

  const removeAt = (i: number) => {
    setList((prev) =>
      prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, displayOrder: idx })),
    );
  };

  const handleSave = async () => {
    if (list.length === 0) return;
    setSaving(true);
    try {
      await api.putPreferences({ benchmarkSymbols: list });
      router.refresh();
      onOpenChange(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setQuery("");
      setResults([]);
    }
    if (o) setList(currentSymbols);
    onOpenChange(o);
  };

  const dirty =
    JSON.stringify(list.map((s) => s.symbol)) !==
    JSON.stringify(currentSymbols.map((s) => s.symbol));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("editBenchmark")}</DialogTitle>
          <DialogDescription>{t("editBenchmarkHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {list.map((s, i) => (
              <span
                key={s.symbol}
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium"
              >
                {s.displayName}
                <button
                  type="button"
                  onClick={() => removeAt(i)}
                  className="rounded-full p-0.5 text-text-3 transition-colors hover:text-foreground"
                  aria-label={t("remove")}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            {list.length === 0 && <p className="px-0.5 text-xs text-text-3">{t("noBenchmarks")}</p>}
          </div>

          {list.length < MAX && (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
                <Input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    runSearch(e.target.value);
                  }}
                  placeholder={t("searchBenchmark")}
                  className="h-10 pl-9 pr-9 text-sm"
                />
                {loading && (
                  <Spinner
                    size="sm"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-3"
                  />
                )}
              </div>

              {query.trim() === "" && results.length === 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-3">
                    <Sparkles className="size-3.5" />
                    {t("suggested")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {SUGGESTED.map((sym) => {
                      const picked = list.some((s) => s.symbol === sym);
                      return (
                        <button
                          key={sym}
                          type="button"
                          onClick={() => addSymbol(sym, benchmarkLabel(sym))}
                          disabled={picked}
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                            picked
                              ? "bg-secondary text-text-3 opacity-50"
                              : "bg-secondary text-secondary-foreground hover:bg-accent"
                          }`}
                        >
                          <Plus className="size-3" />
                          {benchmarkLabel(sym)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {results.length > 0 && (
                <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-border">
                  {results.map((r) => {
                    const picked = list.some((s) => s.symbol === r.symbol);
                    return (
                      <button
                        key={r.symbol}
                        type="button"
                        onClick={() => addSymbol(r.symbol, r.name)}
                        disabled={picked}
                        className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent ${
                          picked ? "opacity-50" : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{r.symbol}</span>
                          {r.name && <span className="ml-1.5 text-text-3">{r.name}</span>}
                        </span>
                        {r.currency && (
                          <span className="shrink-0 text-xs text-text-3">{r.currency}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              {t("cancel")}
            </Button>
            <Button size="sm" disabled={!dirty || list.length === 0 || saving} onClick={handleSave}>
              {saving ? t("saving") : t("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

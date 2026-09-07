"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { benchmarkLabel } from "@/lib/benchmark-labels";
import { X, Plus } from "lucide-react";
import type { BenchmarkSymbolEntry } from "@portfolio/api-client";

const MAX = 3;

export function BenchmarkSettingsForm({
  symbols,
  rate,
}: {
  symbols: BenchmarkSymbolEntry[];
  rate: number | null;
}) {
  const t = useTranslations("Settings");
  const api = useApiClient();
  const router = useRouter();
  const [list, setList] = useState<BenchmarkSymbolEntry[]>(symbols);
  const [draft, setDraft] = useState("");
  const [riskFreeRate, setRiskFreeRate] = useState(rate != null ? String(rate) : "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty =
    JSON.stringify(list) !== JSON.stringify(symbols) ||
    (riskFreeRate !== "" ? Number(riskFreeRate) : null) !== rate;

  const addDraft = () => {
    const v = draft.trim();
    if (!v) return;
    if (list.some((s) => s.symbol === v)) {
      setDraft("");
      return;
    }
    if (list.length >= MAX) return;
    setList([...list, { symbol: v, displayName: benchmarkLabel(v), displayOrder: list.length }]);
    setDraft("");
  };

  const removeAt = (i: number) => {
    const next = list.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, displayOrder: idx }));
    setList(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.putPreferences({
        benchmarkSymbols: list.map((s) => ({ symbol: s.symbol, displayName: s.displayName })),
        riskFreeRate: riskFreeRate !== "" ? Number(riskFreeRate) : null,
      });
      setSaved(true);
      router.refresh();
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-text-3">{t("benchmarkSymbolLabel")}</label>
        <p className="px-0.5 text-xs text-muted-foreground">{t("benchmarkSymbolHint")}</p>
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
                aria-label={t("removeBenchmark")}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        {list.length < MAX && (
          <div className="flex gap-1.5">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                }
              }}
              placeholder="^GSPC"
              className="h-8 text-sm"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addDraft}
              disabled={!draft.trim()}
            >
              <Plus className="size-3.5" />
              {t("addBenchmark")}
            </Button>
          </div>
        )}
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium text-text-3">{t("riskFreeRateLabel")}</label>
        <Input
          type="number"
          step="0.001"
          min="0"
          max="1"
          value={riskFreeRate}
          onChange={(e) => {
            setRiskFreeRate(e.target.value);
            setSaved(false);
          }}
          placeholder="0.03"
          className="h-8 text-sm"
        />
        <p className="px-0.5 text-xs text-muted-foreground">{t("riskFreeRateHint")}</p>
      </div>
      <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
        {saving ? t("saving") : saved ? t("saved") : t("save")}
      </Button>
    </div>
  );
}

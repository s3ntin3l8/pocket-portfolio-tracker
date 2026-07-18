"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import type {
  DetectedPlan,
  DriftRow,
  SparplanContributionSplit,
  TargetWeight,
  TradeAction,
} from "@portfolio/api-client";

function sum(rows: { targetPct: number }[]): number {
  return rows.reduce((acc, r) => acc + r.targetPct, 0);
}

export interface RebalanceProps {
  portfolioId: string;
  plans: DetectedPlan[];
  /** Existing drift rows (from the API response) — drives the recommended split display. */
  drift?: DriftRow[];
  /** Existing contribution split (from the API response). */
  contributionSplit?: SparplanContributionSplit[];
}

export function useRebalance({ portfolioId, plans, contributionSplit }: RebalanceProps) {
  const t = useTranslations("RebalanceDialog");
  const api = useApiClient();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ key: string; label: string; targetPct: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [includeSales, setIncludeSales] = useState(false);
  const [salesLoading, setSalesLoading] = useState(false);
  const [tradeActions, setTradeActions] = useState<TradeAction[] | null>(null);
  const [allowanceUsed, setAllowanceUsed] = useState<string | null>(null);
  const [remainingAllowance, setRemainingAllowance] = useState<string | null>(null);
  const [taxUnavailable, setTaxUnavailable] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);

  const fetchTargets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const existing = await api.getPortfolioTargets(portfolioId, "instrument");
      const targetByKey = new Map(existing.map((tw: TargetWeight) => [tw.key, tw.targetPct]));
      setRows(
        plans.map((p) => ({
          key: p.instrumentId,
          label: p.name ?? p.symbol ?? p.instrumentId,
          targetPct: targetByKey.get(p.instrumentId) ?? 0,
        })),
      );
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [api, portfolioId, plans, t]);

  const fetchTradeRecommendations = useCallback(async () => {
    setSalesLoading(true);
    setSalesError(null);
    try {
      const result = await api.getPortfolioSparplan(portfolioId, true);
      if (result.taxUnavailable) {
        setTaxUnavailable(true);
        setTradeActions(null);
      } else {
        setTaxUnavailable(false);
        setTradeActions(result.tradeActions ?? []);
        setAllowanceUsed(result.allowanceUsed ?? null);
        setRemainingAllowance(result.remainingAllowance ?? null);
      }
    } catch {
      setSalesError(t("loadSalesError"));
    } finally {
      setSalesLoading(false);
    }
  }, [api, portfolioId, t]);

  function handleOpenChange(value: boolean) {
    setOpen(value);
    if (value) {
      void fetchTargets();
      setIncludeSales(false);
      setTradeActions(null);
      setAllowanceUsed(null);
      setRemainingAllowance(null);
      setTaxUnavailable(false);
      setSalesError(null);
    }
  }

  function handleToggleSales(checked: boolean) {
    setIncludeSales(checked);
    if (checked && tradeActions === null) {
      void fetchTradeRecommendations();
    }
  }

  function updateRow(key: string, value: string) {
    const pct = parseFloat(value);
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, targetPct: Number.isNaN(pct) ? 0 : pct } : r)),
    );
  }

  const total = sum(rows);
  const sumOk = Math.abs(total - 100) <= 0.5;

  async function handleSave() {
    if (!sumOk) return;
    setSaving(true);
    setError(null);
    try {
      const targets: TargetWeight[] = rows.map((r) => ({
        key: r.key,
        targetPct: r.targetPct,
      }));
      await api.putPortfolioTargets(portfolioId, "instrument", targets);
      setOpen(false);
      router.refresh();
    } catch {
      setError(t("saveError"));
    } finally {
      setSaving(false);
    }
  }

  const labelByKey = new Map(
    plans.map((p) => [p.instrumentId, p.name ?? p.symbol ?? p.instrumentId]),
  );
  const splitByKey = new Map(contributionSplit?.map((s) => [s.key, s]) ?? []);
  const toggleDisabled = taxUnavailable;

  return {
    t,
    open,
    rows,
    loading,
    saving,
    error,
    includeSales,
    salesLoading,
    tradeActions,
    allowanceUsed,
    remainingAllowance,
    salesError,
    total,
    sumOk,
    labelByKey,
    splitByKey,
    toggleDisabled,
    handleOpenChange,
    handleToggleSales,
    updateRow,
    handleSave,
  };
}

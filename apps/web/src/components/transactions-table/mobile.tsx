"use client";

import { useTranslations, useLocale } from "next-intl";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { cn, formatMoney, anomalyLabel, type AnomalyTranslator } from "@/lib/utils";
import { TxRow, KIND_ICON } from "./types";
import { TypeIconChip, SourceChips, txNetAmount, rowPerShareDisplay } from "./utils";
import type { Anomaly } from "@portfolio/api-client";

export function MobileView({
  dayGroups,
  selectionMode,
  selected,
  anomalyByTxId,
  longPressHandlers,
  onRowActivate,
  hasActiveFilter,
  showEmpty,
}: {
  dayGroups: { day: string; label: string; rows: TxRow[] }[];
  selectionMode: boolean;
  selected: Set<string>;
  anomalyByTxId: Map<string, Anomaly>;
  longPressHandlers: (id: string) => {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onPointerMove: (e: React.PointerEvent) => void;
  };
  onRowActivate: (tx: TxRow) => void;
  hasActiveFilter: boolean;
  showEmpty: boolean;
}) {
  const t = useTranslations("Transactions");
  const tb = useTranslations("Transactions.batch");
  const tt = useTranslations("TxType");
  const ta = useTranslations("Anomalies");
  const locale = useLocale();
  const m = (n: number, currency: string) => formatMoney(n, currency, locale);

  return (
    <div className="space-y-4 md:hidden">
      {dayGroups.map((group) => (
        <div key={group.day}>
          <div className="mb-2 ml-1 text-[12px] font-bold uppercase tracking-[0.04em] text-text-3">
            {group.label}
          </div>
          <div className="overflow-hidden rounded-[20px] bg-card shadow-card">
            {group.rows.map((tx, i) => {
              const netAmount = txNetAmount(tx);
              const isSelected = selected.has(tx.id);
              const anomaly = anomalyByTxId.get(tx.id);
              const status = tx.status ?? "normal";
              const perShareDisplay = rowPerShareDisplay(tx, m);
              const sub =
                Number(tx.quantity) > 0
                  ? `${Number(tx.quantity)} @ ${m(Number(tx.price), tx.currency)}`
                  : tx.shares && perShareDisplay
                    ? `${tx.shares} @ ${perShareDisplay}`
                    : (tx.instrument?.displayName ?? tx.instrument?.name ?? t("cashLabel"));
              return (
                <div
                  key={tx.id}
                  data-state={isSelected ? "selected" : undefined}
                  onClick={() => onRowActivate(tx)}
                  {...longPressHandlers(tx.id)}
                  className={cn(
                    "flex cursor-pointer select-none items-center gap-3 px-[15px] py-[14px]",
                    i > 0 && "border-t border-line",
                    status === "archived" && "opacity-50",
                    status === "draft" && "bg-amber-50/40 dark:bg-amber-950/10",
                    isSelected && "bg-primary/10",
                  )}
                >
                  {selectionMode && (
                    <input
                      type="checkbox"
                      readOnly
                      aria-label={tb("selectRow")}
                      checked={isSelected}
                      className="size-4 shrink-0 accent-primary"
                    />
                  )}
                  <TypeIconChip type={tx.type} kind={tx.kind} className="size-10 rounded-[12px]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-[7px]">
                      <span className="truncate text-sm font-bold">
                        {tx.kind && KIND_ICON[tx.kind] ? tt(tx.kind) : tt(tx.type)}
                        {tx.instrument?.symbol ? ` · ${tx.instrument.symbol}` : ""}
                      </span>
                      {anomaly && (
                        <span
                          title={anomalyLabel(anomaly, ta as AnomalyTranslator, locale)}
                          aria-label={anomalyLabel(anomaly, ta as AnomalyTranslator, locale)}
                        >
                          {anomaly.severity === "error" ? (
                            <AlertCircle className="size-3.5 shrink-0 text-destructive" />
                          ) : (
                            <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-text-2">
                      <span className="truncate">{sub}</span>
                      <span className="flex shrink-0 flex-wrap items-center gap-1">
                        <SourceChips
                          tx={tx}
                          t={t}
                          chipClassName="inline-flex shrink-0 items-center whitespace-nowrap rounded-[6px] px-1.5 py-[2px] text-[9px] font-bold uppercase"
                        />
                      </span>
                    </div>
                  </div>
                  <div
                    className={cn(
                      "tabular shrink-0 text-sm font-bold",
                      netAmount > 0 && "text-success",
                    )}
                  >
                    {m(netAmount, tx.currency)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {showEmpty && (
        <div className="rounded-[20px] bg-card px-4 py-8 text-center text-sm text-muted-foreground shadow-card">
          {hasActiveFilter ? t("noResults") : t("empty")}
        </div>
      )}
    </div>
  );
}

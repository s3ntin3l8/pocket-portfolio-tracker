"use client";

import { useTranslations } from "next-intl";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { TradeAction } from "@portfolio/api-client";
import { formatMoney } from "@/lib/utils";

interface TradeActionsProps {
  tradeActions: TradeAction[];
  allowanceUsed: string | null;
  remainingAllowance: string | null;
  currency: string;
  labelByKey: Map<string, string>;
}

export function TradeActionsSection({
  tradeActions,
  allowanceUsed,
  remainingAllowance,
  currency,
  labelByKey,
}: TradeActionsProps) {
  const t = useTranslations("RebalanceDialog");
  const sells = tradeActions.filter((a) => a.side === "sell");
  const buys = tradeActions.filter((a) => a.side === "buy");

  return (
    <div className="border-t pt-3 mt-1 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{t("tradeActions")}</p>
      {sells.length > 0 && (
        <div className="space-y-1">
          {sells.map((a) => (
            <div key={a.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1 text-destructive shrink-0">
                <TrendingDown className="h-3 w-3" />
                {t("sell")}
              </span>
              <span className="text-muted-foreground truncate flex-1 text-xs">
                {labelByKey.get(a.key) ?? a.key}
              </span>
              <span className="tabular font-medium shrink-0">
                {formatMoney(Number(a.deltaValue), currency, "en")}
              </span>
            </div>
          ))}
        </div>
      )}
      {buys.length > 0 && (
        <div className="space-y-1">
          {buys.map((a) => (
            <div key={a.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400 shrink-0">
                <TrendingUp className="h-3 w-3" />
                {t("buy")}
              </span>
              <span className="text-muted-foreground truncate flex-1 text-xs">
                {labelByKey.get(a.key) ?? a.key}
              </span>
              <span className="tabular font-medium shrink-0">
                {formatMoney(Number(a.deltaValue), currency, "en")}
              </span>
            </div>
          ))}
        </div>
      )}
      {sells.length > 0 && allowanceUsed !== null && remainingAllowance !== null && (
        <p className="text-xs text-muted-foreground border-t pt-2">
          {t("allowanceUsed", {
            used: formatMoney(Number(allowanceUsed), currency, "en"),
            remaining: formatMoney(Number(remainingAllowance), currency, "en"),
          })}
        </p>
      )}
    </div>
  );
}

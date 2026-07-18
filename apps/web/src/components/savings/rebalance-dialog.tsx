"use client";

import { useTranslations } from "next-intl";
import { Target } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/utils";

import { useRebalance } from "./use-rebalance";
import { TradeActionsSection } from "./trade-actions-section";
import type { RebalanceProps } from "./use-rebalance";

export function RebalanceDialog({
  portfolioId,
  plans,
  activeMonthlyTotalDisplay,
  currency,
  drift,
  contributionSplit,
  trigger,
}: RebalanceProps & {
  activeMonthlyTotalDisplay: string;
  currency: string;
  trigger?: React.ReactNode;
}) {
  const t = useTranslations("RebalanceDialog");
  const r = useRebalance({ portfolioId, plans, drift, contributionSplit });

  return (
    <Dialog open={r.open} onOpenChange={r.handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
            <Target className="h-3 w-3" />
            {t("trigger")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {r.loading ? (
          <div className="flex justify-center py-6">
            <Spinner size="md" className="text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-3 py-2">
            {r.rows.map((row) => (
              <div key={row.key} className="flex items-center gap-3">
                <Label className="flex-1 text-sm font-normal">{row.label}</Label>
                <div className="flex items-center gap-1 w-24">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={row.targetPct === 0 ? "" : String(row.targetPct)}
                    placeholder="0"
                    className="h-7 text-right tabular text-sm"
                    onChange={(e) => r.updateRow(row.key, e.target.value)}
                  />
                  <span className="text-sm text-muted-foreground shrink-0">%</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sum indicator */}
        {!r.loading && (
          <div
            className={`text-xs text-right tabular ${
              r.sumOk ? "text-muted-foreground" : "text-destructive font-medium"
            }`}
          >
            {t("total")}: {r.total.toFixed(1)}% {!r.sumOk && t("mustEqual100")}
          </div>
        )}

        {/* Phase D: Toggle between contributions-only and tax-aware sales */}
        {!r.loading && drift && drift.length > 0 && (
          <div className="border-t pt-3 mt-1">
            <div
              className="flex items-center gap-2"
              title={r.toggleDisabled ? t("toggleDisabled") : undefined}
            >
              <Switch
                id="include-sales-toggle"
                checked={r.includeSales}
                onCheckedChange={r.handleToggleSales}
                disabled={r.toggleDisabled}
                aria-label={r.includeSales ? t("toggleSales") : t("toggleContributions")}
              />
              <Label
                htmlFor="include-sales-toggle"
                className={`text-xs cursor-pointer ${r.toggleDisabled ? "text-muted-foreground/50" : "text-muted-foreground"}`}
              >
                {r.includeSales ? t("toggleSales") : t("toggleContributions")}
              </Label>
              {r.salesLoading && <Spinner size="xs" className="text-muted-foreground" />}
            </div>
            {r.toggleDisabled && (
              <p className="text-xs text-muted-foreground/70 mt-1">{t("toggleDisabled")}</p>
            )}
          </div>
        )}

        {/* Recommended split (contributions-only mode) */}
        {!r.loading &&
          !r.includeSales &&
          drift &&
          drift.length > 0 &&
          contributionSplit &&
          contributionSplit.length > 0 && (
            <div className="border-t pt-3 mt-1">
              <p className="text-xs font-medium text-muted-foreground mb-2">
                {t("recommendedSplit")}{" "}
                <span className="tabular">
                  ({formatMoney(Number(activeMonthlyTotalDisplay), currency, "en")})
                </span>
              </p>
              <div className="space-y-1">
                {drift.map((d) => {
                  const s = r.splitByKey.get(d.key);
                  if (!s) return null;
                  const label = r.labelByKey.get(d.key) ?? d.key;
                  return (
                    <div key={d.key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground truncate flex-1">{label}</span>
                      <span className="tabular font-medium shrink-0">
                        {formatMoney(Number(s.amount), currency, "en")}
                      </span>
                      <span className="text-xs text-muted-foreground shrink-0 w-12 text-right">
                        {s.sharePct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        {/* Phase D: Trade recommendations (tax-aware sales mode) */}
        {!r.loading &&
          r.includeSales &&
          !r.salesLoading &&
          r.tradeActions &&
          r.tradeActions.length > 0 && (
            <TradeActionsSection
              tradeActions={r.tradeActions}
              allowanceUsed={r.allowanceUsed}
              remainingAllowance={r.remainingAllowance}
              currency={currency}
              labelByKey={r.labelByKey}
            />
          )}

        {/* No trade actions when all instruments are on-target */}
        {!r.loading &&
          r.includeSales &&
          !r.salesLoading &&
          r.tradeActions &&
          r.tradeActions.length === 0 && (
            <div className="border-t pt-3 mt-1">
              <p className="text-xs text-muted-foreground">{t("tradeActions")}: —</p>
            </div>
          )}

        {r.salesError && <p className="text-xs text-destructive">{r.salesError}</p>}
        {r.error && <p className="text-xs text-destructive">{r.error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => r.handleOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button onClick={r.handleSave} disabled={!r.sumOk || r.saving || r.loading}>
            {r.saving ? <Spinner size="sm" className="mr-1" /> : null}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

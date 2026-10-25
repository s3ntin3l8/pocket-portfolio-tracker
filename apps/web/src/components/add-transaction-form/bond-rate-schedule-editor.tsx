"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  validateRateScheduleDraft,
  type RatePeriodDraft,
  type RateScheduleDraft,
} from "@/lib/bond-rate";

/**
 * The editor for a FLOATING-rate bond's coupon-rate schedule (Indonesian retail SBR/ST
 * series: the rate resets every three months off the BI reference rate while the
 * PAYMENTS stay monthly).
 *
 * The pure conversion/validation helpers live in `@/lib/bond-rate` so the
 * server-rendered instrument detail page can reuse them without a client boundary.
 */
export function BondRateScheduleEditor({
  value,
  onChange,
  t,
  idPrefix = "rate",
}: {
  value: RateScheduleDraft;
  onChange: (next: RateScheduleDraft) => void;
  /** Translator bound to the `BondTerms` namespace. */
  t: (key: string) => string;
  /** Prefix for the input ids — the create form and the edit dialog both render this. */
  idPrefix?: string;
}) {
  const issue = validateRateScheduleDraft(value);
  const setPeriod = (i: number, patch: Partial<RatePeriodDraft>) => {
    const periods = value.periods.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    onChange({ ...value, periods });
  };
  const addPeriod = () => {
    // Seed the new period with the end of the last one, so a quarterly ladder is one
    // tap per period instead of retyping the dates.
    const last = value.periods[value.periods.length - 1];
    const from = last?.to?.trim() || "";
    onChange({
      ...value,
      periods: [...value.periods, { from, to: "", ratePercent: last?.ratePercent ?? "" }],
    });
  };
  const removePeriod = (i: number) => {
    onChange({ ...value, periods: value.periods.filter((_, idx) => idx !== i) });
  };

  return (
    <div className="col-span-2 flex flex-col gap-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-floor`}>{t("floorRateLabel")}</Label>
        <Input
          id={`${idPrefix}-floor`}
          inputMode="decimal"
          value={value.floorRatePercent}
          onChange={(e) => onChange({ ...value, floorRatePercent: e.target.value })}
          placeholder="6.75"
        />
        <p className="text-xs text-text-2">{t("floorRateHint")}</p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>{t("ratePeriodsLabel")}</Label>
          <Button type="button" variant="ghost" size="sm" onClick={addPeriod}>
            <Plus className="size-3.5" />
            {t("addRatePeriod")}
          </Button>
        </div>
        {value.periods.length === 0 ? (
          <p className="text-xs text-text-2">{t("ratePeriodsEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {value.periods.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-from-${i}`} className="text-xs">
                    {t("ratePeriodFrom")}
                  </Label>
                  <Input
                    id={`${idPrefix}-from-${i}`}
                    type="date"
                    value={p.from}
                    onChange={(e) => setPeriod(i, { from: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-to-${i}`} className="text-xs">
                    {t("ratePeriodTo")}
                  </Label>
                  <Input
                    id={`${idPrefix}-to-${i}`}
                    type="date"
                    value={p.to}
                    onChange={(e) => setPeriod(i, { to: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${idPrefix}-rate-${i}`} className="text-xs">
                    {t("ratePeriodRate")}
                  </Label>
                  <Input
                    id={`${idPrefix}-rate-${i}`}
                    inputMode="decimal"
                    value={p.ratePercent}
                    onChange={(e) => setPeriod(i, { ratePercent: e.target.value })}
                    placeholder="6.75"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("removeRatePeriod")}
                  onClick={() => removePeriod(i)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {issue && (
        <p role="alert" className="text-xs text-destructive">
          {t(`issue.${issue}`)}
        </p>
      )}
    </div>
  );
}

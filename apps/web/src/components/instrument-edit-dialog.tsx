"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import type { BondCouponRateSchedule, Instrument } from "@portfolio/api-client";
import { apiErrorCode } from "@portfolio/api-client";
import { defaultPartialExemptionRate } from "@portfolio/core";
import { fractionToPercent, percentToFraction } from "@/lib/tax-rate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useApiClient } from "@/lib/api";
import { Checkbox } from "@/components/ui/checkbox";
import { BondRateScheduleEditor } from "./add-transaction-form/bond-rate-schedule-editor";
import {
  checkRateScheduleDraft,
  rateScheduleToDraft,
  type RateScheduleDraft,
} from "@/lib/bond-rate";
import { useRouter } from "@/i18n/navigation";
import { toast } from "sonner";

const ASSET_CLASSES = [
  "equity",
  "gold",
  "bond",
  "mutual_fund",
  "etf",
  "crypto",
  "derivative",
] as const;

const FUND_CLASSES = new Set(["etf", "mutual_fund"]);

export function InstrumentEditDialog({
  instrument,
  children,
}: {
  instrument: Instrument;
  children: React.ReactNode;
}) {
  const t = useTranslations("Instrument");
  const tc = useTranslations("AssetClass");
  const tb = useTranslations("BondTerms");
  const api = useApiClient();
  const router = useRouter();
  const formId = useId();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [isin, setIsin] = useState(instrument.isin ?? "");
  const [wkn, setWkn] = useState(instrument.wkn ?? "");
  const [symbol, setSymbol] = useState(instrument.symbol);
  const [name, setName] = useState(instrument.name);
  const [assetClass, setAssetClass] = useState(instrument.assetClass);
  const [market, setMarket] = useState(instrument.market);
  const [tfPercent, setTfPercent] = useState(fractionToPercent(instrument.partialExemptionRate));
  // Floating-rate bond (SBR/ST): the coupon rate resets, the payments don't. The
  // schedule is edited here because `instruments` is shared reference data — only an
  // admin may change the terms every holder's projection depends on.
  const [floatingRate, setFloatingRate] = useState(instrument.couponRateSchedule != null);
  const [rateSchedule, setRateSchedule] = useState<RateScheduleDraft>(() =>
    rateScheduleToDraft(instrument.couponRateSchedule),
  );

  function reset() {
    setIsin(instrument.isin ?? "");
    setWkn(instrument.wkn ?? "");
    setSymbol(instrument.symbol);
    setName(instrument.name);
    setAssetClass(instrument.assetClass);
    setMarket(instrument.market);
    setTfPercent(fractionToPercent(instrument.partialExemptionRate));
    setFloatingRate(instrument.couponRateSchedule != null);
    setRateSchedule(rateScheduleToDraft(instrument.couponRateSchedule));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const isFund = FUND_CLASSES.has(assetClass);
    // Blank clears the override (the asset-class default applies again).
    const tfFraction = tfPercent.trim() === "" ? null : percentToFraction(tfPercent);
    if (isFund && tfPercent.trim() !== "" && tfFraction === null) {
      toast.error(t("tfInvalid"));
      return;
    }
    // An unusable schedule must NOT be sent as `null`: that would clear the shared
    // rate schedule for every holder of the series (and the bond would fall out of
    // the income/tax forecast entirely). A half-filled draft is a mistake to report,
    // not a request to delete the schedule — the same shape as the `tfInvalid` guard
    // above. `null` is sent only when the toggle was deliberately switched off.
    let couponRateSchedule: BondCouponRateSchedule | null | undefined;
    if (assetClass === "bond" && floatingRate) {
      // Validate AND convert in one step: the schedule that goes out is the one the
      // check produced, so an unusable draft can never be turned into a `null` —
      // which is what would wipe the shared schedule.
      const check = checkRateScheduleDraft(rateSchedule);
      if (!check.ok) {
        toast.error(tb(`issue.${check.issue}`));
        return;
      }
      couponRateSchedule = check.schedule;
    } else if (assetClass === "bond" && instrument.couponRateSchedule != null) {
      couponRateSchedule = null;
    }
    setBusy(true);
    try {
      await api.updateInstrument(instrument.id, {
        isin: isin || null,
        wkn: wkn || null,
        symbol,
        name,
        assetClass,
        market,
        // Only fund classes expose the override. Typed text survives an in-dialog class
        // round-trip (fund → other → fund) on purpose; submit reads `tfPercent` as-is.
        // Moving a fund *off* a fund class clears its stored override, because
        // `buildTfRates` would otherwise keep applying it to the non-fund.
        ...(isFund
          ? { partialExemptionRate: tfFraction }
          : instrument.partialExemptionRate != null
            ? { partialExemptionRate: null }
            : {}),
        // Only touch the rate schedule when the instrument is a bond AND the floating
        // toggle actually changed something — an admin renaming a bond must not clear
        // the schedule behind their back.
        ...(assetClass === "bond" && couponRateSchedule !== undefined
          ? { couponRateSchedule }
          : {}),
      });
      router.refresh();
      toast.success(t("editSaved"));
      setOpen(false);
    } catch (err) {
      const code = apiErrorCode(err);
      if (code === "identifier_conflict") {
        toast.error(t("editConflict"));
      } else {
        toast.error(t("editError"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      {/* Overlay chrome migration (#625): centered sm-size card at md:+, full-screen page
          below it — was an unconditional bottom Sheet despite the component's name. */}
      <DialogContent
        size="sm"
        mobileHeader={{ title: t("editTitle") }}
        footer={
          <Button type="submit" form={formId} disabled={busy} className="w-full">
            {busy && <Spinner size="sm" />}
            {busy ? t("saving") : t("save")}
          </Button>
        }
      >
        <div className="p-4 md:p-6">
          <DialogTitle className="hidden text-lg font-semibold md:mb-3 md:block">
            {t("editTitle")}
          </DialogTitle>
          <form id={formId} onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-isin`}>{t("isin")}</Label>
              <Input id={`${uid}-isin`} value={isin} onChange={(e) => setIsin(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-wkn`}>{t("wkn")}</Label>
              <Input id={`${uid}-wkn`} value={wkn} onChange={(e) => setWkn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-symbol`}>{t("symbol")}</Label>
              <Input
                id={`${uid}-symbol`}
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-name`}>{t("name")}</Label>
              <Input
                id={`${uid}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-asset-class`}>{t("assetClass")}</Label>
              <Select
                id={`${uid}-asset-class`}
                value={assetClass}
                onChange={(e) => setAssetClass(e.target.value)}
              >
                {ASSET_CLASSES.map((ac) => (
                  <option key={ac} value={ac}>
                    {tc(ac)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${uid}-market`}>{t("market")}</Label>
              <Input
                id={`${uid}-market`}
                value={market}
                onChange={(e) => setMarket(e.target.value)}
                required
              />
            </div>
            {assetClass === "bond" && (
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    id={`${uid}-floating`}
                    checked={floatingRate}
                    onCheckedChange={(v) => setFloatingRate(v === true)}
                  />
                  <div className="space-y-0.5">
                    <Label htmlFor={`${uid}-floating`} className="text-sm">
                      {tb("floatingRateLabel")}
                    </Label>
                    <p className="text-xs text-muted-foreground">{tb("floatingRateHint")}</p>
                  </div>
                </div>
                {floatingRate && (
                  <BondRateScheduleEditor
                    value={rateSchedule}
                    onChange={setRateSchedule}
                    t={tb}
                    idPrefix={`${uid}-rate`}
                  />
                )}
              </div>
            )}
            {FUND_CLASSES.has(assetClass) && (
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-tf`}>{t("tfRate")}</Label>
                <Input
                  id={`${uid}-tf`}
                  inputMode="decimal"
                  value={tfPercent}
                  placeholder={fractionToPercent(defaultPartialExemptionRate(assetClass)) + "%"}
                  onChange={(e) => setTfPercent(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">{t("tfRateHint")}</p>
              </div>
            )}
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useId, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Instrument } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { useApiClient } from "@/lib/api";
import { useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Manual-price maintenance for asset classes no live market-data provider serves —
 * today, Indonesian retail bonds/sukuk (no schedulable secondary-market feed exists;
 * see docs/data_providers.md). Read in valuePortfolio() ahead of the bond par
 * fallback (services/api/src/services/valuation.ts). Not admin-gated: maintaining a
 * price for a series you hold is a normal action, not reference-data curation — same
 * rationale as leaving `POST /instruments` open — but `instruments` is shared
 * reference data, so this changes valuation for every user holding the series.
 *
 * The input is percent-of-par (what the Indonesian secondary market actually quotes,
 * e.g. "101.35") when the instrument has a `faceValue`; the computed absolute price is
 * shown live and is what's actually sent to the API.
 */
export function InstrumentManualPriceCard({ instrument }: { instrument: Instrument }) {
  const t = useTranslations("Instrument");
  const locale = useLocale();
  const api = useApiClient();
  const router = useRouter();
  const uid = useId();
  const [busy, setBusy] = useState(false);

  const faceValue = instrument.faceValue != null ? Number(instrument.faceValue) : null;
  const currentPct =
    faceValue && instrument.manualPrice != null
      ? ((Number(instrument.manualPrice) / faceValue) * 100).toFixed(4).replace(/\.?0+$/, "")
      : "";
  const [pct, setPct] = useState(currentPct);

  const parsedPct = Number(pct);
  const previewAbsolute =
    faceValue && pct.trim() !== "" && Number.isFinite(parsedPct)
      ? (faceValue * parsedPct) / 100
      : null;

  async function save() {
    if (busy || !faceValue) return;
    if (pct.trim() === "" || !Number.isFinite(parsedPct) || parsedPct <= 0) {
      toast.error(t("manualPriceInvalid"));
      return;
    }
    setBusy(true);
    try {
      await api.setManualPrice(instrument.id, previewAbsolute!.toString());
      router.refresh();
      toast.success(t("manualPriceSaved"));
    } catch {
      toast.error(t("manualPriceError"));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (busy) return;
    setBusy(true);
    try {
      await api.setManualPrice(instrument.id, null);
      setPct("");
      router.refresh();
      toast.success(t("manualPriceCleared"));
    } catch {
      toast.error(t("manualPriceError"));
    } finally {
      setBusy(false);
    }
  }

  if (!faceValue) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("manualPriceTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{t("manualPriceNote")}</p>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor={`${uid}-manual-pct`}>{t("manualPricePercentLabel")}</Label>
            <Input
              id={`${uid}-manual-pct`}
              inputMode="decimal"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              placeholder="101.35"
            />
          </div>
          <Button type="button" onClick={save} disabled={busy}>
            {busy && <Spinner size="sm" />}
            {t("save")}
          </Button>
          {instrument.manualPrice != null && (
            <Button type="button" variant="ghost" onClick={clear} disabled={busy}>
              {t("manualPriceClear")}
            </Button>
          )}
        </div>
        {previewAbsolute != null && (
          <p className="text-xs text-muted-foreground">
            {t("manualPricePreview", {
              amount: formatMoney(previewAbsolute, instrument.currency, locale),
            })}
          </p>
        )}
        {instrument.manualPrice != null && instrument.manualPriceAt && (
          <p className="text-xs text-muted-foreground">
            {t("asOfLabel", {
              date: new Date(instrument.manualPriceAt).toLocaleDateString(locale, {
                year: "numeric",
                month: "short",
                day: "numeric",
              }),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

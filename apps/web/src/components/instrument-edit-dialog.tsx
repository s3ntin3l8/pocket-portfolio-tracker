"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Spinner } from "@/components/ui/spinner";
import type { Instrument } from "@portfolio/api-client";
import { apiErrorCode } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useApiClient } from "@/lib/api";
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

export function InstrumentEditDialog({
  instrument,
  children,
}: {
  instrument: Instrument;
  children: React.ReactNode;
}) {
  const t = useTranslations("Instrument");
  const tc = useTranslations("AssetClass");
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

  function reset() {
    setIsin(instrument.isin ?? "");
    setWkn(instrument.wkn ?? "");
    setSymbol(instrument.symbol);
    setName(instrument.name);
    setAssetClass(instrument.assetClass);
    setMarket(instrument.market);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await api.updateInstrument(instrument.id, {
        isin: isin || null,
        wkn: wkn || null,
        symbol,
        name,
        assetClass,
        market,
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
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState, useEffect } from "react";
import { BookOpen } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { useApiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { TaxTranslator } from "@/components/tax/tax-cards";

export function LossCarryforwardEditor({
  holderId,
  currentYear,
  t,
}: {
  holderId: string;
  currentYear: number;
  t: TaxTranslator;
}) {
  const router = useRouter();
  const api = useApiClient();
  // `taxYear` is the year the carry-forward is *applied in* (see
  // lossCarryForwardFor on the API side), not the year it originated from — so this
  // must default to, and include, the year currently on screen.
  const [year, setYear] = useState(currentYear);
  const [stock, setStock] = useState("0");
  const [general, setGeneral] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getLossCarryforward(holderId, year)
      .then((res) => {
        if (cancelled) return;
        const stockEntry = res.entries.find((e) => e.pot === "stock");
        const generalEntry = res.entries.find((e) => e.pot === "general");
        setStock(stockEntry?.amount ?? "0");
        setGeneral(generalEntry?.amount ?? "0");
      })
      .catch(() => {
        // Silently ignore — fields keep their current values
      });
    return () => {
      cancelled = true;
    };
  }, [api, holderId, year]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.setLossCarryforward(holderId, {
        taxYear: year,
        entries: [
          { pot: "stock", amount: stock || "0" },
          { pot: "general", amount: general || "0" },
        ],
      });
      toast.success(t("lossCarryforward.success"));
      router.refresh();
    } catch {
      toast.error(t("lossCarryforward.error"));
    } finally {
      setSaving(false);
    }
  };

  const years = Array.from({ length: 10 }, (_, i) => currentYear - i);

  // Entered as a positive figure (a loss amount, per the labels/hints below) — strip
  // any minus sign rather than silently netting to zero downstream (compute.ts clamps
  // negative carry-forward to 0 with no feedback to the user).
  const sanitizeAmount = (v: string) => v.replace(/-/g, "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <BookOpen className="size-4" />
          {t("lossCarryforward.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">{t("lossCarryforward.description")}</p>

        <div>
          <Label>{t("lossCarryforward.yearLabel")}</Label>
          <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>{t("lossCarryforward.stockLabel")}</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={stock}
              onChange={(e) => setStock(sanitizeAmount(e.target.value))}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("lossCarryforward.stockHint")}
            </p>
          </div>
          <div>
            <Label>{t("lossCarryforward.generalLabel")}</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={general}
              onChange={(e) => setGeneral(sanitizeAmount(e.target.value))}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("lossCarryforward.generalHint")}
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t("lossCarryforward.saving") : t("lossCarryforward.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

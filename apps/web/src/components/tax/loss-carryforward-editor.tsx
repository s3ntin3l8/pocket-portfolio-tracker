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
  initialStock,
  initialGeneral,
  t,
}: {
  holderId: string;
  currentYear: number;
  initialStock: string;
  initialGeneral: string;
  t: TaxTranslator;
}) {
  const router = useRouter();
  const api = useApiClient();
  const [year, setYear] = useState(currentYear - 1);
  const [stock, setStock] = useState(initialStock);
  const [general, setGeneral] = useState(initialGeneral);
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

  const years = Array.from({ length: 10 }, (_, i) => currentYear - 1 - i);

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
            <Input type="text" value={stock} onChange={(e) => setStock(e.target.value)} />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t("lossCarryforward.stockHint")}
            </p>
          </div>
          <div>
            <Label>{t("lossCarryforward.generalLabel")}</Label>
            <Input type="text" value={general} onChange={(e) => setGeneral(e.target.value)} />
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

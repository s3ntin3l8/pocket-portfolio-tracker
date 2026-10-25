"use client";

import { useState, useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BookOpen } from "lucide-react";
import { toast } from "sonner";
import { useApiClient } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ErrorBanner } from "@/components/ui/error-banner";

type LoadStatus = "loading" | "loaded" | "error";

export function LossCarryforwardEditor({
  holderId,
  currentYear,
}: {
  holderId: string;
  currentYear: number;
}) {
  const t = useTranslations("Tax");
  const tError = useTranslations("Error");
  const tDataState = useTranslations("DataState");
  const api = useApiClient();
  const router = useRouter();
  // `taxYear` is the year the carry-forward is *applied in* (see
  // lossCarryForwardFor on the API side), not the year it originated from — so this
  // must default to, and include, the year currently on screen.
  const uid = useId();
  const [year, setYear] = useState(currentYear);
  const [stock, setStock] = useState("");
  const [general, setGeneral] = useState("");
  const [saving, setSaving] = useState(false);
  // The load's outcome, tagged with the request it belongs to. A result only counts
  // for the holder/year it was fetched for — any other request (another year, a
  // retry) puts the editor back into "loading", so an amount the user never saw
  // loaded can never be saved.
  const [load, setLoad] = useState<{ key: string; status: LoadStatus }>({
    key: "",
    status: "loading",
  });
  const [reloadToken, setReloadToken] = useState(0);
  const loadKey = `${holderId}|${year}|${reloadToken}`;
  const status: LoadStatus = load.key === loadKey ? load.status : "loading";
  // A minus sign typed into an amount is stripped (a loss pot is a positive
  // magnitude) — remember that we did, so the UI can say so instead of silently
  // changing the number the user typed.
  const [negativeIgnored, setNegativeIgnored] = useState({ stock: false, general: false });
  const clearedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = loadKey;
    if (clearedKeyRef.current !== key) {
      // A different holder/year/retry: the amounts on screen belong to the previous
      // request and must not be presented — let alone saved — as the new ones.
      clearedKeyRef.current = key;
      setStock("");
      setGeneral("");
      // The previous verdict belongs to the previous request. It must be dropped, not
      // carried over: revisiting a year (2026 → 2025 → 2026) makes the *new* key equal
      // the old one again, and a stale "loaded" would otherwise make the blanked
      // fields saveable — saving an empty set clears every pot for that year.
      setLoad({ key: "", status: "loading" });
      // The "a minus sign was dropped" hint described the amounts that were just
      // cleared; it must not survive into the new request.
      setNegativeIgnored({ stock: false, general: false });
    }
    api
      .getLossCarryforward(holderId, year)
      .then((res) => {
        if (cancelled) return;
        const stockEntry = res.entries.find((e) => e.pot === "stock");
        const generalEntry = res.entries.find((e) => e.pot === "general");
        setStock(stockEntry?.amount ?? "0");
        setGeneral(generalEntry?.amount ?? "0");
        setLoad((prev) =>
          prev.key === key && prev.status === "loaded" ? prev : { key, status: "loaded" },
        );
      })
      .catch(() => {
        // Don't swallow the failure: the amounts are unknown, and letting the user
        // save an unknown amount would overwrite the real carry-forward with zeros.
        if (cancelled) return;
        setLoad((prev) =>
          prev.key === key && prev.status === "error" ? prev : { key, status: "error" },
        );
      });
    return () => {
      cancelled = true;
    };
  }, [api, holderId, year, loadKey]);

  const handleSave = async () => {
    // Only ever save what the user saw loaded: while the load is in flight, or after
    // it failed, the amounts on screen are unknown.
    if (status !== "loaded") return;
    setSaving(true);
    try {
      // The amounts go out exactly as they are on screen — no `|| "0"` fallback,
      // which would silently write a zero over a real carry-forward. An emptied
      // field means "no carry-forward for this pot"; the API replaces the whole set
      // for the year, so leaving that pot out clears it.
      const allEntries: { pot: "stock" | "general"; amount: string }[] = [
        { pot: "stock", amount: stock },
        { pot: "general", amount: general },
      ];
      const entries = allEntries.filter((e) => e.amount.trim() !== "");
      await api.setLossCarryforward(holderId, {
        taxYear: year,
        entries,
      });
      toast.success(t("lossCarryforward.success"));
      // Refresh server-rendered tax figures (estimated tax, allowance usage, harvest
      // suggestions) that depend on carry-forward data. A single post-save refresh is
      // safe — the mount-path fetch already populated local state, so there's no
      // re-render cascade.
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

  const handleAmountChange = (pot: "stock" | "general", raw: string) => {
    const sanitized = sanitizeAmount(raw);
    // A dropped minus sign silently changes the number, so flag it: keep the hint
    // up while the user keeps typing the amount, drop it once the field is emptied.
    setNegativeIgnored((prev) => ({
      ...prev,
      [pot]: raw.includes("-") ? true : raw === "" ? false : prev[pot],
    }));
    if (pot === "stock") setStock(sanitized);
    else setGeneral(sanitized);
  };

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

        {status === "error" && (
          <div className="space-y-2">
            <ErrorBanner>
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{tError("title")}</span>
                <span>{t("lossCarryforward.loadError")}</span>
              </span>
            </ErrorBanner>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReloadToken((n) => n + 1)}
              disabled={saving}
            >
              {tDataState("retry")}
            </Button>
          </div>
        )}

        <div>
          <Label htmlFor={`lcf-${uid}-year`}>{t("lossCarryforward.yearLabel")}</Label>
          <Select
            id={`lcf-${uid}-year`}
            value={String(year)}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`lcf-${uid}-stock`}>{t("lossCarryforward.stockLabel")}</Label>
            <Input
              id={`lcf-${uid}-stock`}
              type="text"
              inputMode="decimal"
              value={stock}
              readOnly={status !== "loaded"}
              aria-busy={status === "loading"}
              onChange={(e) => handleAmountChange("stock", e.target.value)}
            />
            <p className="mt-1 text-micro text-muted-foreground">
              {status === "loading"
                ? t("lossCarryforward.loading")
                : t("lossCarryforward.stockHint")}
            </p>
            {negativeIgnored.stock && (
              <p role="status" className="text-micro text-muted-foreground">
                {t("lossCarryforward.negativeIgnored")}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor={`lcf-${uid}-general`}>{t("lossCarryforward.generalLabel")}</Label>
            <Input
              id={`lcf-${uid}-general`}
              type="text"
              inputMode="decimal"
              value={general}
              readOnly={status !== "loaded"}
              aria-busy={status === "loading"}
              onChange={(e) => handleAmountChange("general", e.target.value)}
            />
            <p className="mt-1 text-micro text-muted-foreground">
              {status === "loading"
                ? t("lossCarryforward.loading")
                : t("lossCarryforward.generalHint")}
            </p>
            {negativeIgnored.general && (
              <p role="status" className="text-micro text-muted-foreground">
                {t("lossCarryforward.negativeIgnored")}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving || status !== "loaded"}>
            {saving ? t("lossCarryforward.saving") : t("lossCarryforward.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

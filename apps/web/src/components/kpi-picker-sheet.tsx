"use client";
import { useState } from "react";
import { Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useMediaQuery } from "@/lib/use-media-query";
import { useApiClient } from "@/lib/api";

const ALL_KPI_KEYS = [
  "netWorth",
  "xirr",
  "dayChange",
  "totalPnL",
  "income",
  "cash",
  "positions",
] as const;
type KpiKey = (typeof ALL_KPI_KEYS)[number];

interface KpiPickerSheetProps {
  /** Currently saved KPI list, or null to show all. */
  currentKpis: string[] | null;
}

/**
 * Refinement tier (#625 overlay chrome migration): a Popover anchored to its trigger at
 * md:+, a compact bottom Sheet below it. Both chromes live in a single mounted tree —
 * one below md, the other at md+ — so crossing the breakpoint never unmounts the
 * toggle list. `useMediaQuery` is read once for any per-viewport internals; the chrome
 * swap itself is purely CSS (`max-md:hidden` / `md:hidden`).
 */
export function KpiPickerSheet({ currentKpis }: KpiPickerSheetProps) {
  const t = useTranslations("KpiPicker");
  const router = useRouter();
  const api = useApiClient();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [open, setOpen] = useState(false);
  const active = currentKpis ?? [...ALL_KPI_KEYS];
  const [selected, setSelected] = useState<Set<string>>(new Set(active));
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const ordered = ALL_KPI_KEYS.filter((k) => selected.has(k));
      await api.putPreferences({ dashboardKpis: ordered });
      setOpen(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const fields = (
    <div className="space-y-3">
      {ALL_KPI_KEYS.map((key) => (
        <div key={key} className="flex items-center gap-2">
          <Switch id={key} checked={selected.has(key)} onCheckedChange={() => toggle(key)} />
          <Label htmlFor={key}>{t(key as KpiKey)}</Label>
        </div>
      ))}
    </div>
  );

  const actions = (
    <div className="flex justify-end gap-2 pt-4">
      <Button variant="outline" onClick={() => setOpen(false)}>
        {t("cancel")}
      </Button>
      <Button onClick={save} disabled={saving}>
        {t("save")}
      </Button>
    </div>
  );

  return (
    <div>
      <Popover open={open && isDesktop} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <Button variant="ghost" size="sm" aria-label={t("title")} onClick={() => setOpen(true)}>
            <Settings2 className="size-4" />
            <span className="sr-only">{t("title")}</span>
          </Button>
        </PopoverAnchor>
        <PopoverContent className="max-md:hidden">
          <p className="mb-1 text-sm font-semibold">{t("title")}</p>
          <p className="mb-3 text-xs text-muted-foreground">{t("description")}</p>
          {fields}
          {actions}
        </PopoverContent>
      </Popover>
      <Sheet open={open && !isDesktop} onOpenChange={setOpen}>
        <SheetContent className="md:hidden">
          <SheetHeader>
            <SheetTitle>{t("title")}</SheetTitle>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </SheetHeader>
          <div className="py-4">{fields}</div>
          {actions}
        </SheetContent>
      </Sheet>
    </div>
  );
}

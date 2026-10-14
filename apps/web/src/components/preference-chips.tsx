"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { useApiClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

interface ChipOption {
  value: string;
  label: string;
}

interface Props {
  /**
   * Which global user-preference field this chip group writes. Kept generic so the
   * same component backs the Settings → Investing "Tax code"/"Cost basis" chips. These
   * are GLOBAL preferences (written via `putPreferences`), so they live only in
   * Settings — never as a page-level filter; `router.refresh()` makes every
   * server-rendered consumer (e.g. the Tax page) pick up the new value.
   */
  prefKey: "taxRegime" | "costBasisMode";
  current: string;
  options: ChipOption[];
  /** "compact" = the Tax screen's nested pill toggle; "wide" = the Settings screens'
   *  full-width segmented chips (reference ccyOn/ccyOff: flex-1, 13px, 11px radius). */
  variant?: "compact" | "wide";
  /** Extra classes for the wrapping pill. */
  className?: string;
  /** Accessible name for the radiogroup. */
  "aria-label"?: string;
}

/** A small segmented control that persists its selection as a global user preference
 *  and refreshes the current route so every consumer picks up the new value. */
export function PreferenceChips({
  prefKey,
  current,
  options,
  variant = "compact",
  className,
  "aria-label": ariaLabel,
}: Props) {
  const router = useRouter();
  const api = useApiClient();
  const [pending, setPending] = useState<string | null>(null);

  async function select(value: string) {
    if (value === current || pending) return;
    setPending(value);
    try {
      if (prefKey === "taxRegime") {
        await api.putPreferences({ taxRegime: value as "DE" | "ID" });
      } else {
        await api.putPreferences({ costBasisMode: value as "purchase_price" | "total_paid" });
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  const wide = variant === "wide";
  return (
    <ToggleGroup
      value={current}
      onValueChange={select}
      disabled={pending !== null}
      aria-label={ariaLabel}
      className={
        wide
          ? cn("w-full gap-[7px]", className)
          : cn(
              "inline-flex items-center gap-1 rounded-md border border-border bg-card p-[3px] shadow-card",
              className,
            )
      }
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className={
            wide
              ? cn(
                  "touch-target relative flex-1 rounded-sm py-[9px] text-center text-body-sm disabled:opacity-60",
                  current === o.value
                    ? "bg-pill font-bold text-white"
                    : "bg-background font-semibold text-foreground",
                )
              : cn(
                  "touch-target relative rounded-sm px-3.5 py-1.5 text-xs font-bold disabled:opacity-60",
                  current === o.value
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )
          }
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

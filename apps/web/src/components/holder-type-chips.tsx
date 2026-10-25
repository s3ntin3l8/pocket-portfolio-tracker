"use client";

import { useTranslations } from "next-intl";
import type { AccountHolderType } from "@portfolio/api-client";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const TYPES: AccountHolderType[] = ["self", "child", "other"];

/**
 * Segmented chip control for the account-holder type (reference: Self / Child / Other) —
 * replaces the native `<select>` in both the portfolio and holder create/edit sheets.
 *
 * Built on the shared `ui/toggle-group` primitive (a Radix `ToggleGroup`), so it is a real
 * radio group: `role="radiogroup"` with `aria-checked` on the options and the radio keyboard
 * pattern (one tab stop into the group, arrow keys move between the options). Pass
 * `labelledBy` (the id of the field label) for a11y.
 */
export function HolderTypeChips({
  value,
  onChange,
  labelledBy,
}: {
  value: AccountHolderType;
  onChange: (v: AccountHolderType) => void;
  labelledBy?: string;
}) {
  const t = useTranslations("PortfolioForm");
  return (
    <ToggleGroup
      value={value}
      onValueChange={(v) => onChange(v as AccountHolderType)}
      aria-labelledby={labelledBy}
      className="flex gap-2"
    >
      {TYPES.map((tp) => {
        const on = value === tp;
        return (
          <ToggleGroupItem
            key={tp}
            value={tp}
            className={cn(
              "flex-1 rounded-sm py-2.5 text-body-sm transition-colors",
              on
                ? "bg-primary font-bold text-primary-foreground"
                : "border border-border bg-card font-semibold text-foreground hover:bg-accent/50",
            )}
          >
            {t(`holderType${tp.charAt(0).toUpperCase()}${tp.slice(1)}`)}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

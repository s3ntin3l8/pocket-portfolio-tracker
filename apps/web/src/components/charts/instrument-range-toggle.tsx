"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { INSTRUMENT_PRICE_RANGES, type InstrumentPriceRange } from "@/lib/instrument-price-range";

/**
 * The Instrument-detail price hero's own 1M/6M/1Y/All chip row — visually mirrors
 * `charts/range-toggle.tsx` but is typed to {@link InstrumentPriceRange}, a deliberately
 * separate (smaller) vocabulary from the portfolio net-worth `ChartRange` — see that file's
 * doc comment for why they're kept apart rather than sharing one generic component.
 */
export function InstrumentRangeToggle({
  value,
  onChange,
  disabled,
}: {
  value: InstrumentPriceRange;
  onChange: (range: InstrumentPriceRange) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("Instrument.priceRange");
  return (
    <ToggleGroup
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      aria-label={t("label")}
      className="gap-1"
    >
      {INSTRUMENT_PRICE_RANGES.map((r) => (
        <ToggleGroupItem
          key={r}
          value={r}
          className={cn(
            "rounded-full px-3.5 py-[7px] text-xs font-bold",
            value === r ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent",
          )}
        >
          {t(r)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

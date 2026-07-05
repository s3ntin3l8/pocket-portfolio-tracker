import { cn } from "@/lib/utils";
import { monogram, tintFor, assetClassTone } from "@/lib/brokerages";

/**
 * Small monogram badge (2 letters) anchoring a list row to its instrument/source —
 * the reference uses these throughout (Holdings/Trades rows, Savings plan rows, Tax
 * harvest rows). When `assetClass` is known, matches the reference's soft rounded-square
 * chip tinted per asset class (`chipBg`/`chipFg` in `Pocket Prototype.dc.html`). Falls
 * back to a hash-derived solid circle (any name → a stable, but class-agnostic, hue) for
 * contexts without a resolvable asset class (e.g. savings-plan rows).
 */
export function MonogramBadge({
  label,
  assetClass,
  className,
}: {
  label: string;
  assetClass?: string | null;
  className?: string;
}) {
  if (assetClass) {
    const tone = assetClassTone(assetClass);
    return (
      <span
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-xl text-[0.7rem] font-extrabold",
          className,
        )}
        style={{ backgroundColor: tone.bg, color: tone.fg }}
        aria-hidden
      >
        {monogram(label)}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-bold text-white",
        className,
      )}
      style={{ backgroundColor: tintFor(label) }}
      aria-hidden
    >
      {monogram(label)}
    </span>
  );
}

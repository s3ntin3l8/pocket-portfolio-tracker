import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { BasisLabel } from "@/components/basis-label";

/** Direction of a gain figure — drives the value colour (green up / red down / neutral). */
export type Tone = "up" | "down" | "flat";

/** Tone of a signed number: positive up, negative down, zero/unknown flat. */
export const toneOf = (n: number | null | undefined): Tone =>
  n == null || !Number.isFinite(n) || n === 0 ? "flat" : n > 0 ? "up" : "down";

const toneClass = (tone: Tone) =>
  tone === "up" ? "text-success" : tone === "down" ? "text-destructive" : "";

/**
 * Which denominator a gain is measured against (audit G2):
 * - `cost` — the cost of the holdings still open ("vs cost of holdings"; Holdings rail, sidebar)
 * - `contributed` — net money that crossed the portfolio boundary ("vs net contributed"; Savings)
 */
export type GainBasis = "cost" | "contributed";

/**
 * One gain figure with its basis spelled out. Every gain number in the app goes through this
 * so the same scope can't show differently-based numbers side by side without saying which is
 * which. Takes pre-formatted strings (callers format with `formatSignedMoney`/`formatPercent`)
 * so it renders identically from server and client components.
 *
 * - `stacked` — amount and percent on one line, the basis label underneath (rails, cards).
 * - `inline` — percent followed by the basis label on a single line (tight spots: sidebar).
 */
export function GainFigure({
  amount,
  pct,
  tone,
  basis,
  layout = "stacked",
  amountClassName,
  pctClassName,
  className,
}: {
  amount?: string | null;
  pct?: string | null;
  tone: Tone;
  basis: GainBasis;
  layout?: "stacked" | "inline";
  amountClassName?: string;
  pctClassName?: string;
  className?: string;
}) {
  const t = useTranslations("Gain");
  const label = basis === "cost" ? t("basisCost") : t("basisContributed");
  const colour = toneClass(tone);

  if (layout === "inline") {
    return (
      <p className={cn("tabular", className)}>
        {pct != null && <span className={cn("font-bold", colour, pctClassName)}>{pct}</span>}
        {pct != null && amount != null && " "}
        {amount != null && (
          <span className={cn("font-bold", colour, amountClassName)}>{amount}</span>
        )}{" "}
        <span className="font-medium text-text-2">{label}</span>
      </p>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-baseline gap-2">
        {amount != null && (
          <p className={cn("tabular text-lg font-bold", colour, amountClassName)}>{amount}</p>
        )}
        {pct != null && (
          <p className={cn("tabular text-body-sm font-bold", colour, pctClassName)}>{pct}</p>
        )}
      </div>
      <BasisLabel>{label}</BasisLabel>
    </div>
  );
}

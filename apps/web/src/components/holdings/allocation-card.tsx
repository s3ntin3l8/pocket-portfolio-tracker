import { AllocationDonut, type DonutSlice } from "@/components/charts/allocation-donut";
import { cn } from "@/lib/utils";

/** Direction of a gain figure — drives the value colour (green up / red down / neutral). */
export type Tone = "up" | "down" | "flat";

const toneClass = (tone: Tone) =>
  tone === "up" ? "text-success" : tone === "down" ? "text-destructive" : "";

/** One stat column: a small label over a primary figure, optionally a secondary figure
 *  below it (used to stack the EUR amount over its % on the performance columns). */
function Stat({
  label,
  primary,
  secondary,
  tone = "flat",
  primaryClass = "text-[18px]",
}: {
  label: string;
  primary: string;
  secondary?: string | null;
  tone?: Tone;
  primaryClass?: string;
}) {
  return (
    // Narrow containers (the Holdings sidebar, ~272px) get a row form — label left,
    // figures right on one baseline — since a stacked block or grid column doesn't leave
    // room for a value like "€132,865.24" at text-[22px]. @3xl restores the original
    // stacked block once the card has the width to spread three of these into columns.
    // Primary+secondary are grouped into one flex child so the row stays a 2-way split
    // (label | figures) instead of `justify-between` spreading all three evenly.
    <div className="flex min-w-0 items-baseline justify-between gap-3 @3xl:block">
      <p className="min-w-0 shrink truncate text-[11px] font-semibold text-text-3">{label}</p>
      <div className="flex shrink-0 items-baseline gap-2 @3xl:block">
        <p
          className={cn(
            "tabular whitespace-nowrap font-extrabold @3xl:mt-0.5",
            primaryClass,
            toneClass(tone),
          )}
        >
          {primary}
        </p>
        {secondary != null && (
          <p
            className={cn(
              "tabular whitespace-nowrap text-[13px] font-bold @3xl:mt-0.5",
              toneClass(tone),
            )}
          >
            {secondary}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The Holdings "Allocation" card: the class-donut (reused wholesale, incl. its own
 * legend) plus, on desktop only, a stats strip that fills the width the donut used to
 * leave empty — the total value alongside two performance columns (all-time, today),
 * each showing its EUR amount over its % gain. No card title — the reference shows the
 * donut directly (its own center label already reads "Assets"), and no tab switcher
 * either — unlike `AllocationTabs` (Class|Currency|Region|Sector), the design shows only
 * the class breakdown on this screen; Region/Currency get their own card below (see
 * `RegionCurrencyCard`), and Sector isn't shown on Holdings at all.
 */
export function AllocationCard({
  slices,
  currency,
  total,
  totalLabel,
  totalValueFormatted,
  allTimeLabel,
  allTimeAmount,
  allTimePct,
  allTimeTone = "flat",
  todayLabel,
  todayAmount,
  todayPct,
  todayTone = "flat",
}: {
  slices: DonutSlice[];
  currency: string;
  /** Sum of `slices` — passed straight through to `AllocationDonut` for its center label. */
  total: number;
  totalLabel: string;
  /** Pre-formatted (locale-aware) total value for the desktop-only stats strip. */
  totalValueFormatted: string;
  allTimeLabel: string;
  /** All-time unrealized P&L as a signed money string (EUR amount). */
  allTimeAmount: string;
  /** All-time gain as a percent string, or null when cost basis is unknown. */
  allTimePct: string | null;
  allTimeTone?: Tone;
  todayLabel: string;
  /** Today's change as a signed money string (EUR amount). */
  todayAmount: string;
  /** Today's change as a percent string, or null when a prior base is unavailable. */
  todayPct: string | null;
  todayTone?: Tone;
}) {
  // Transcribed from `Pocket Prototype.dc.html`: padding 20px 24px; on a wide-enough
  // container the donut keeps a bounded width so the stats no longer sit against the far
  // edge across a wide empty gap — instead they spread as three columns over the
  // reclaimed space, separated by the --line border. Labels 600 11px text-3, total 800
  // 22px, all-time/today amounts 800 18px over a 700 13px % line.
  //
  // This card is `@container`-scoped so the arrangement below tracks the space it
  // actually has (it lives in a fixed ~272px sidebar on Holdings, not the viewport) —
  // see @3xl below. The stats strip's *visibility*, by contrast, stays gated on the
  // viewport at `lg` (matching the pre-existing boundary) rather than the container,
  // deliberately: it is a "does this card show extra detail on desktop" decision, not a
  // "does it fit" one — the row form below fits comfortably narrower than that.
  return (
    <div className="@container rounded-[18px] bg-card px-6 py-5 shadow-card">
      <div className="flex flex-col gap-7 @3xl:flex-row @3xl:items-center @3xl:gap-8">
        <div className="@3xl:w-[400px] @3xl:shrink-0">
          <AllocationDonut data={slices} currency={currency} total={total} />
        </div>
        <div className="hidden lg:block @3xl:flex-1 @3xl:border-l @3xl:border-line @3xl:pl-8">
          <div className="mt-5 flex flex-col gap-3 border-t border-line pt-5 @3xl:mt-0 @3xl:grid @3xl:grid-cols-3 @3xl:items-center @3xl:gap-6 @3xl:border-t-0 @3xl:pt-0">
            <Stat label={totalLabel} primary={totalValueFormatted} primaryClass="text-[22px]" />
            <Stat
              label={allTimeLabel}
              primary={allTimeAmount}
              secondary={allTimePct}
              tone={allTimeTone}
            />
            <Stat label={todayLabel} primary={todayAmount} secondary={todayPct} tone={todayTone} />
          </div>
        </div>
      </div>
    </div>
  );
}

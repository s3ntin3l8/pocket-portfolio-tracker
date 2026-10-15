import { InfoTip } from "@/components/ui/tooltip";
import { AlertTriangle, X } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { BasisLabel } from "@/components/basis-label";
import { FlowBreakdownRow } from "@/components/transactions/flow-breakdown-row";
import type { AllBannerData, IncomeBannerData, TradeBannerData } from "@/lib/transaction-banners";

const CARD = "@container rounded-2xl bg-card p-[22px] shadow-card";

const TONE_CLASS: Record<"up" | "down" | "neutral", string> = {
  up: "text-success",
  down: "text-destructive",
  neutral: "text-muted-foreground",
};

function StatBlock({
  label,
  value,
  sub,
  tone = "neutral",
  bordered = false,
  basis,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "neutral";
  bordered?: boolean;
  /** What the figure counts, when that isn't obvious from the label. */
  basis?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0",
        bordered &&
          "border-t border-line pt-2.5 sm:pt-4 @xl:border-l @xl:border-t-0 @xl:pl-2.5 @xl:sm:pl-4 @xl:pl-6 @xl:pt-0",
      )}
    >
      <p className="truncate text-micro font-semibold text-text-2 sm:text-xs">{label}</p>
      <p className="tabular mt-1 truncate text-sm font-extrabold sm:text-xl @xl:text-display">
        {value}
      </p>
      {sub && (
        <p
          className={cn(
            "tabular mt-0.5 truncate text-micro font-bold sm:text-xs",
            TONE_CLASS[tone],
          )}
        >
          {sub}
        </p>
      )}
      {basis && <BasisLabel>{basis}</BasisLabel>}
    </div>
  );
}

function Breakdown({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="col-span-full border-t border-line pt-4 @xl:col-span-2 @xl:border-l @xl:border-t-0 @xl:pl-6 @xl:pt-0">
      <p className="mb-2.5 text-micro font-semibold uppercase tracking-[.04em] text-text-2">
        {label}
      </p>
      <div className="flex flex-col gap-2.5">{children}</div>
    </div>
  );
}

/** "All" filter banner: 3 headline tiles + a "Cash flow mix" breakdown. */
export function AllFilterBanner({
  data,
  cashFlowMixLabel,
}: {
  data: AllBannerData;
  cashFlowMixLabel: string;
}) {
  return (
    <div className={CARD}>
      <div className="grid grid-cols-1 gap-2.5 @xl:grid-cols-3 @xl:gap-4">
        {data.tiles.map((t, i) => (
          <StatBlock
            key={i}
            label={t.label}
            value={t.value}
            sub={t.sub}
            tone={t.tone}
            bordered={i > 0}
            basis={t.basis}
          />
        ))}
        {data.mix.length > 0 && (
          <Breakdown label={cashFlowMixLabel}>
            {data.mix.map((m, i) => (
              <FlowBreakdownRow key={i} {...m} />
            ))}
          </Breakdown>
        )}
      </div>
    </div>
  );
}

/** "Income" filter banner: Projected · 12mo + "By source" breakdown. The YTD
 *  received figure is always visible in the "All" banner, so this skips the redundant tile. */
export function IncomeFilterBanner({
  data,
  projectedLabel,
  bySourceLabel,
}: {
  data: IncomeBannerData;
  projectedLabel: string;
  bySourceLabel: string;
}) {
  return (
    <div className={CARD}>
      <div className="grid grid-cols-1 gap-2.5 @xl:grid-cols-3 @xl:items-center @xl:gap-4">
        <StatBlock
          label={projectedLabel}
          value={data.projected}
          sub={data.projectedNote}
          tone="neutral"
        />
        <Breakdown label={bySourceLabel}>
          {data.bySource.length > 0 ? (
            data.bySource.map((m, i) => <FlowBreakdownRow key={i} {...m} />)
          ) : (
            <p className="text-xs text-muted-foreground">—</p>
          )}
        </Breakdown>
      </div>
    </div>
  );
}

/** "Buys"/"Sells" filter banner: average order + per-symbol breakdown. The headline
 *  total is always visible in the "All" banner, so this skips the redundant stat tile. */
export function TradeFilterBanner({
  data,
  averageLabel,
  averageNote,
  headingLabel,
}: {
  data: TradeBannerData;
  averageLabel: string;
  averageNote: string;
  headingLabel: string;
}) {
  return (
    <div className={CARD}>
      <div className="grid grid-cols-1 gap-2.5 @xl:grid-cols-3 @xl:items-center @xl:gap-4">
        <StatBlock label={averageLabel} value={data.avg} sub={averageNote} tone="neutral" />
        <Breakdown label={headingLabel}>
          {data.bySymbol.map((m, i) => (
            <FlowBreakdownRow key={i} {...m} />
          ))}
        </Breakdown>
      </div>
    </div>
  );
}

/**
 * A distinct, always-visible (not gated by the "Show flagged" row-toggle, since these are
 * portfolio-scoped and carry no `transactionId` to flag a row with) banner for cash/position
 * reconciliation-gap anomalies against a connected broker.
 */
export function ReconciliationBanner({
  title,
  detail,
  tag,
  dismissLabel,
  onDismiss,
  action,
}: {
  title: string;
  detail: string;
  tag: string;
  /** A link to where the gap can be looked at / fixed (the holding, the connection). */
  action?: { href: string; label: string };
  /** Accessible name for the dismiss button — this component takes pre-resolved
   *  strings (no `useTranslations` here, so it stays usable from a server component),
   *  so callers must pass their own `Anomalies.dismiss` translation. */
  dismissLabel?: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-card px-4 py-3.5 shadow-hairline">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
        <AlertTriangle className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{title}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
        {action && (
          <Link
            href={action.href}
            className="mt-1.5 inline-block text-xs font-semibold text-warn-strong underline-offset-2 hover:underline"
          >
            {action.label}
          </Link>
        )}
      </div>
      <span className="shrink-0 rounded-md bg-warning/15 px-2 py-1 text-micro font-bold uppercase tracking-wide text-warn-strong">
        {tag}
      </span>
      {onDismiss && (
        <InfoTip label={dismissLabel ?? title}>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel ?? title}
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground/50 hover:text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </InfoTip>
      )}
    </div>
  );
}

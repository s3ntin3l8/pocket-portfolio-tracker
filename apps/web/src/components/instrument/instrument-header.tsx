import { BackLink } from "@/components/back-button";
import { getTranslations } from "next-intl/server";
import { Pencil } from "lucide-react";
import type { Instrument } from "@portfolio/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InstrumentLogo } from "@/components/instrument-logo";
import { instrumentLogoTransitionName } from "@/lib/instrument-logo-transition";
import { InstrumentEditDialog } from "@/components/instrument-edit-dialog";
import { PageTitle } from "@/components/page-header";

/** `className="md:flex"` keeps it visible on desktop for pages with no topbar title (error states). */
export async function InstrumentBackButton({
  className,
  backHref,
}: {
  className?: string;
  /**
   * Where "back" goes. Defaults to the tab that owns instruments (`/holdings`); a page that
   * knows where the visitor came from passes that route instead, so the link returns them
   * there rather than to the holdings tab (audit R4-G3).
   */
  backHref?: string;
}) {
  const tA11y = await getTranslations("A11y");
  // The "Back to holdings" label only describes the default target - with another target
  // the generic "Back" is the honest name.
  return (
    <BackLink
      href={backHref ?? "/holdings"}
      label={backHref ? tA11y("back") : tA11y("backToHoldings")}
      className={className}
    />
  );
}

/**
 * Instrument hero: back button, logo chip + name as the primary heading, symbol + asset
 * class + market + currency on the secondary line. Desktop topbar renders the name via
 * PageHeaderSetter in the page, so this row stays mobile-first without duplicating it.
 * Lives in its own file so the logo (a shared-element morph target) can be edited without
 * touching the page's data flow.
 */
export async function InstrumentHeader({
  instrument,
  heroName,
  isAdmin,
  backHref,
}: {
  instrument: Instrument;
  heroName: string;
  isAdmin: boolean;
  /** The back target; see {@link InstrumentBackButton}. */
  backHref?: string;
}) {
  const [t, tc] = await Promise.all([getTranslations("Instrument"), getTranslations("AssetClass")]);
  return (
    <div className="flex items-start gap-3">
      <InstrumentBackButton backHref={backHref} />
      <InstrumentLogo
        label={instrument.symbol}
        symbol={instrument.symbol}
        market={instrument.market}
        assetClass={instrument.assetClass}
        transitionName={instrumentLogoTransitionName(instrument.id)}
        className="size-11 shrink-0 rounded-md text-sm"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <PageTitle className="truncate">{heroName}</PageTitle>
          {isAdmin && (
            <InstrumentEditDialog instrument={instrument}>
              <Button variant="ghost" size="icon" aria-label={t("edit")}>
                <Pencil className="size-4" />
              </Button>
            </InstrumentEditDialog>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground/80">{instrument.symbol}</span>
          <Badge variant="outline" className="font-normal">
            {tc(instrument.assetClass)}
          </Badge>
          <span aria-hidden>·</span>
          <span>{instrument.market}</span>
          <span aria-hidden>·</span>
          <span>{instrument.currency}</span>
        </p>
      </div>
    </div>
  );
}

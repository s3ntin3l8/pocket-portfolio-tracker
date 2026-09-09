import { Card, CardContent } from "@/components/ui/card";

/**
 * Cash-interest subtotal — rendered as a StatCard-style tile with a title and
 * three value lines (YTD, TTM, lifetime). Fits naturally in the income sidebar
 * alongside the other stat cards.
 *
 * Pure/presentational: no `useTranslations` — the caller passes already-translated
 * labels and pre-formatted money strings, so this renders identically wherever it's
 * used and needs no i18n provider in tests.
 */
export function CashInterestLine({
  label,
  ytdLabel,
  ttmLabel,
  lifetimeLabel,
  ytd,
  ttm,
  lifetime,
}: {
  label: string;
  ytdLabel: string;
  ttmLabel: string;
  lifetimeLabel: string;
  ytd: string;
  ttm: string;
  lifetime: string;
}) {
  return (
    <Card>
      <CardContent className="px-3.5 py-3.5 sm:px-[18px] sm:py-4">
        <p className="text-[11px] font-semibold text-text-2 sm:text-xs">{label}</p>
        <div className="mt-1.5 space-y-0.5">
          <p className="tabular text-xs sm:text-sm">
            <span className="text-text-mute">{ytdLabel}:</span>{" "}
            <span className="font-bold text-foreground">{ytd}</span>
          </p>
          <p className="tabular text-xs sm:text-sm">
            <span className="text-text-mute">{ttmLabel}:</span>{" "}
            <span className="font-bold text-foreground">{ttm}</span>
          </p>
          <p className="tabular text-xs sm:text-sm">
            <span className="text-text-mute">{lifetimeLabel}:</span>{" "}
            <span className="font-bold text-foreground">{lifetime}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

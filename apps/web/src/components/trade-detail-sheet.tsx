"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Trade } from "@portfolio/api-client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { monogram, tintFor } from "@/lib/brokerages";
import { formatMoney, formatPercent, formatSignedMoney, formatQuantity, cn } from "@/lib/utils";

interface TradeDetailSheetProps {
  /** The trade to show detail for; null renders nothing. Accepts both open and closed
   *  trades — the header, hero, breakdown, and details row set adapt to status.
   *  Closed trades surface realized P&L as the hero; open trades surface total return
   *  (unrealized P&L + dividends) instead. */
  trade: Trade | null;
  /** Display currency — matches every money field on `Trade` except avgEntryPrice/
   *  avgExitPrice, which are in the trade's own (cost) currency. */
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Row({
  label,
  value,
  divider,
  bold,
  tone,
}: {
  label: string;
  value: string;
  divider?: boolean;
  bold?: boolean;
  tone?: "up" | "down" | "neutral";
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-3",
        divider && "border-t border-border",
      )}
    >
      <span
        className={cn("text-sm", bold ? "font-semibold text-foreground" : "text-muted-foreground")}
      >
        {label}
      </span>
      <span
        className={cn(
          "tabular text-sm",
          bold ? "font-extrabold" : "font-semibold",
          tone === "up" && "text-success",
          tone === "down" && "text-destructive",
          !tone && !bold && "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Trade detail overlay — read-only, no submit, so no footer slot. Overlay chrome
 * migration (#625): size="sm", centered card at md:+, full-screen page below it — was
 * an unconditional bottom Sheet with no desktop treatment at all.
 *
 * Content transcribed from `TradesScreen.dc.html`'s `td` object: header, a Realized
 * P&L hero, a Breakdown card, a Trade details card, and an optional Income-while-held
 * card.
 *
 * Deviation from the design: the mock's Breakdown has a 4th "Fees" row (Proceeds − Cost
 * − Fees = Realized). `Trade`/`TradeLeg` don't carry a currency-safe standalone fee
 * figure — fees are already netted into `TradeLeg.cost` (buy side) and `TradeLeg.proceeds`
 * (sell side), and `avgEntryPrice`/`avgExitPrice` are in the trade's own currency rather
 * than the display currency used everywhere else, so back-deriving a fee amount for
 * cross-currency trades would be a currency-unsafe guess. Rendered as 3 rows instead
 * (Proceeds, Cost basis, Realized P&L) — still exact (Proceeds − Cost = Realized).
 *
 * Also: every colored field in the sheet (hero, breakdown P&L, Return, Annualized, Total
 * return incl. income) shares ONE tone derived from the sign of the hero value
 * (realized P&L for closed trades, total return for open) — matching the design's own
 * `td.color`/`td.totalColor` reuse — rather than each field coloring by its own sign.
 */
export function TradeDetailSheet({ trade, currency, open, onOpenChange }: TradeDetailSheetProps) {
  const t = useTranslations("Trades");
  const locale = useLocale();

  if (!trade) return null;

  const symbol = trade.instrument?.symbol ?? trade.instrumentId.slice(0, 8);
  const name = trade.instrument?.name ?? "";
  const isOpen = trade.status === "open";

  const realized = Number(trade.realizedPnL);
  const invested = Number(trade.invested);
  const unrealized = Number(trade.unrealizedPnL);
  const totalReturn = Number(trade.totalReturn);
  // Closed: tone follows realized P&L (final number). Open: follows total return
  // (the live number — unrealized + dividends).
  const hero = isOpen ? totalReturn : realized;
  const tone: "up" | "down" = hero >= 0 ? "up" : "down";
  const heroPct = invested > 0 ? hero / invested : null;

  const proceedsTotal = trade.legs.reduce((s, l) => s + Number(l.proceeds), 0);
  const costTotal = trade.legs.reduce((s, l) => s + Number(l.cost), 0);

  const heldLabel = (days: number) =>
    days >= 365 ? `${(days / 365).toFixed(1)}${t("yearsAbbr")}` : `${days}${t("daysAbbr")}`;

  const money = (n: number) => formatMoney(n, currency, locale);
  const signed = (n: number) => formatSignedMoney(n, currency, locale);
  const pct = (n: number | null) => (n !== null ? formatPercent(n, locale) : "—");

  const hasDividends = Number(trade.dividends) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" mobileHeader={{ title: symbol }}>
        <div className="p-6">
          {/* Desktop-only rich title (avatar + symbol) — mobile gets the compact
              back-chevron + symbol row instead (mobileHeader). Accessible DialogTitle
              lives here regardless of breakpoint, just visually hidden below md. */}
          <div className="hidden items-center gap-3 md:mb-1 md:flex">
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-xs font-extrabold text-white"
              style={{ backgroundColor: tintFor(symbol) }}
              aria-hidden
            >
              {monogram(symbol)}
            </span>
            <DialogTitle className="text-lg font-semibold">{symbol}</DialogTitle>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            {name ? `${name} · ` : ""}
            {isOpen
              ? t("detail.openSince", { date: trade.entryDate })
              : t("detail.closed", { date: trade.exitDate ?? "—" })}
          </p>

          {/* Hero — realized P&L for closed, total return for open (unrealized + dividends) */}
          <div className="py-4 text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {isOpen ? t("detail.totalReturn") : t("detail.realizedPnl")}
            </p>
            <p
              className={cn(
                "tabular mt-1 text-4xl font-extrabold",
                tone === "up" ? "text-success" : "text-destructive",
              )}
            >
              {signed(hero)}
            </p>
            <p className="mt-2">
              <span
                className={cn(
                  "tabular inline-block rounded-full bg-muted px-3 py-1 text-xs font-bold",
                  tone === "up" ? "text-success" : "text-destructive",
                )}
              >
                {pct(heroPct)} · {heldLabel(trade.holdingDays)} {t("detail.held")}
              </span>
            </p>
          </div>

          {/* Breakdown — proceeds/cost for closed (back-derives realized); invested/
              unrealized/dividends for open (sums to total return). */}
          <h3 className="mb-2 mt-2 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t("detail.breakdown")}
          </h3>
          <div className="overflow-hidden rounded-2xl border border-border">
            {isOpen ? (
              <>
                <Row label={t("detail.invested")} value={money(invested)} />
                <Row
                  label={t("detail.unrealizedPnl")}
                  value={signed(unrealized)}
                  divider
                  tone={unrealized >= 0 ? "up" : "down"}
                />
                {realized !== 0 && (
                  <Row
                    label={t("detail.realizedPnlRow")}
                    value={signed(realized)}
                    divider
                    tone={realized > 0 ? "up" : "down"}
                  />
                )}
                {hasDividends && (
                  <Row
                    label={t("detail.dividendsCollected")}
                    value={money(Number(trade.dividends))}
                    tone="up"
                    divider
                  />
                )}
                <Row label={t("detail.totalReturn")} value={signed(totalReturn)} bold tone={tone} />
              </>
            ) : (
              <>
                <Row label={t("detail.proceeds")} value={money(proceedsTotal)} />
                <Row label={t("detail.costBasis")} value={`− ${money(costTotal)}`} divider />
                <Row
                  label={t("detail.realizedPnlRow")}
                  value={signed(realized)}
                  bold
                  tone={tone}
                  divider
                />
              </>
            )}
          </div>

          {/* Trade details */}
          <h3 className="mb-2 mt-5 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t("detail.tradeDetails")}
          </h3>
          <div className="overflow-hidden rounded-2xl border border-border">
            <Row
              label={t("detail.quantity")}
              value={formatQuantity(Number(trade.quantity), trade.instrument?.unit, locale)}
            />
            <Row
              label={t("detail.avgBuyPrice")}
              value={formatMoney(Number(trade.avgEntryPrice), trade.currency, locale)}
              divider
            />
            {!isOpen && (
              <>
                <Row
                  label={t("detail.avgSellPrice")}
                  value={
                    trade.avgExitPrice !== null
                      ? formatMoney(Number(trade.avgExitPrice), trade.currency, locale)
                      : "—"
                  }
                  divider
                />
                <Row label={t("detail.sold")} value={trade.exitDate ?? "—"} divider />
                <Row label={t("detail.return")} value={pct(heroPct)} tone={tone} divider />
                <Row label={t("annualized")} value={pct(trade.annualizedPct)} tone={tone} divider />
              </>
            )}
            <Row label={t("detail.bought")} value={trade.entryDate} divider />
            <Row label={t("detail.holdingPeriod")} value={heldLabel(trade.holdingDays)} divider />
          </div>

          {/* Income while held — only for closed trades with dividends. Open trades
              already surface dividends in the breakdown above. */}
          {hasDividends && !isOpen && (
            <>
              <h3 className="mb-2 mt-5 px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                {t("detail.incomeWhileHeld")}
              </h3>
              <div className="overflow-hidden rounded-2xl border border-border">
                <Row
                  label={t("detail.dividendsCollected")}
                  value={money(Number(trade.dividends))}
                  tone="up"
                />
                <Row
                  label={t("detail.totalReturnIncome")}
                  value={`${signed(Number(trade.totalReturn))} · ${pct(trade.totalReturnPct)}`}
                  bold
                  tone={tone}
                  divider
                />
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

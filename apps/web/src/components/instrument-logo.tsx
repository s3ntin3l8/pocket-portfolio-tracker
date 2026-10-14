"use client";

import { useCallback, useState, ViewTransition } from "react";
import { cn } from "@/lib/utils";
import { MonogramBadge } from "@/components/monogram-badge";

/**
 * logo.dev ticker suffix per internal market — mirrors `yahooSuffixForMarket` in
 * `packages/market-data/src/instrument-mapping.ts` (kept as a small local copy rather than
 * importing that server-side package into the client bundle). Confirmed empirically against
 * the live API: a bare ticker and its suffixed form can resolve to *different* companies
 * (e.g. `ANTM` = US Anthem vs `ANTM.JK` = Aneka Tambang), so the suffix matters for
 * correctness, not just cosmetics. Markets absent here use the bare symbol (correct for US).
 * Exported (rather than kept private) so `instrument-logo.test.tsx` can assert this stays
 * equal to `MARKET_YAHOO_SUFFIX` — the two are only related by convention, not by import,
 * so nothing else would catch them drifting apart if a market gets added to one but not
 * the other.
 */
export const MARKET_LOGO_SUFFIX: Record<string, string> = {
  IDX: ".JK",
  XETRA: ".DE",
};

/**
 * logo.dev URLs that already failed to load this session (module-level, so it survives
 * remounts and is shared by every row/page in the SPA). A known-missing logo renders the
 * monogram immediately instead of re-requesting the 404 on every row, filter change and
 * route transition. Resets on a full page reload — deliberately not persisted, so a logo that
 * logo.dev adds later is picked up on the next session.
 */
const failedLogoUrls = new Set<string>();

/** Test helper: forget remembered 404s. */
export function resetFailedLogoCache() {
  failedLogoUrls.clear();
}

/** Asset classes for which a logo.dev lookup is attempted; everything else is a monogram. */
const LOGO_ASSET_CLASSES = new Set(["equity", "etf", "crypto"]);

function logoDevPath(symbol: string, market: string | null | undefined, assetClass: string) {
  if (assetClass === "crypto") return `crypto/${encodeURIComponent(symbol)}`;
  const suffix = (market && MARKET_LOGO_SUFFIX[market]) ?? "";
  return `ticker/${encodeURIComponent(symbol)}${suffix}`;
}

/**
 * Real company/crypto logo (via logo.dev), falling back to the existing colored-initials
 * `MonogramBadge` when no symbol/asset-class is eligible, the token isn't configured, or the
 * image fails to load (`fallback=404` on the logo.dev URL makes a miss a genuine `onError`,
 * not a silent placeholder image). Equity/ETF/crypto only — gold, cash, bonds, mutual funds
 * and derivatives always render the monogram; see `instrument-logo.test.tsx` for the matrix
 * (verified live: US/XETRA/IDX equities resolve, European UCITS ETFs don't).
 */
export function InstrumentLogo({
  label,
  symbol,
  market,
  assetClass,
  className,
  transitionName,
}: {
  label: string;
  symbol?: string | null;
  market?: string | null;
  assetClass?: string | null;
  className?: string;
  /**
   * `<ViewTransition name>` for a shared-element morph (holdings row -> instrument header).
   * Names must be unique on the page, so a caller that mounts several variants at once
   * (the holdings table and card list) passes it to the visible one only.
   */
  transitionName?: string;
}) {
  const [errored, setErrored] = useState(false);
  // Call sites like the "selected instrument" chip in add-transaction-form.tsx render this
  // component at a stable tree position without a `key`, so React reuses the instance when
  // the instrument changes — without resetting `errored` here, a 404'd instrument would
  // leave it stuck `true` for whatever's selected next, even if its logo would resolve
  // fine. Reset via React's "adjust state during render" pattern (comparing against the
  // previous lookup key) rather than an effect — this is the documented approach for
  // resetting state when inputs change, and it avoids an extra effect-triggered render.
  const lookupKey = `${symbol}:${market}:${assetClass}`;
  const [prevLookupKey, setPrevLookupKey] = useState(lookupKey);
  if (lookupKey !== prevLookupKey) {
    setPrevLookupKey(lookupKey);
    setErrored(false);
  }
  const token = process.env.NEXT_PUBLIC_LOGODEV_TOKEN;

  const lookupEligible = !!token && !!symbol && !!assetClass && LOGO_ASSET_CLASSES.has(assetClass);
  const src = lookupEligible
    ? `https://img.logo.dev/${logoDevPath(symbol, market, assetClass)}?token=${token}&size=128&format=png&fallback=404`
    : null;

  const markFailed = useCallback(() => {
    if (src) failedLogoUrls.add(src);
    setErrored(true);
  }, [src]);

  // SSR'd <img> elements can finish failing before React hydrates and attaches `onError`,
  // which would leave the browser's broken-image glyph on screen forever. A ref callback
  // runs at attach time, so catch the already-failed case there.
  const imgRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth === 0 && img.currentSrc) markFailed();
    },
    [markFailed],
  );

  const withTransition = (node: React.ReactElement) =>
    transitionName ? (
      <ViewTransition name={transitionName} share="vt-logo" default="none">
        {node}
      </ViewTransition>
    ) : (
      node
    );

  if (!src || errored || failedLogoUrls.has(src)) {
    return withTransition(
      <MonogramBadge label={label} assetClass={assetClass} className={className} />,
    );
  }

  return withTransition(
    <span
      className={cn(
        "inline-flex size-[38px] shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted",
        className,
      )}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- external CDN image, next/image is unused in this app */}
      <img
        ref={imgRef}
        src={src}
        alt=""
        className="block size-full object-contain p-1"
        onError={markFailed}
      />
    </span>,
  );
}

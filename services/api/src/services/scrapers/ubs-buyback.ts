import { BROWSER_HEADERS } from "./http.js";
import { GALERI24_BUYBACK_SOURCE_URL, extractBuybackFromHtml } from "./galeri24-buyback.js";

/**
 * Scraper for the UBS (UBS Lifestyle / Untung Bersama Sejahtera) gold **buyback** price — IDR
 * per gram, used to price UBS bar holdings (market `UBS`). Writes into `scraped_quotes`, read
 * in-process by the default UBS provider (or via the authenticated `/internal/gold/ubs-buyback`
 * route for an external URL override).
 *
 * Source: ubslifestyle.com sits behind a Cloudflare challenge (HTTP 403 to non-browser
 * clients), so it is unusable from the server. Galeri24 lists UBS bars in their own `UBS`
 * section of the same server-rendered page already scraped for `GALERI24`, with the same
 * `Berat | Harga Jual | Harga Buyback` grid — so we reuse that extractor on the `UBS` section.
 * That is Galeri24's UBS buyback quote, a close proxy for UBS's own.
 *
 * Returns `null` on any failure (unreachable, layout change, no number) — the provider
 * already treats that as "no quote" and the chain falls through to spot / fixture.
 */
export const UBS_BUYBACK_SOURCE_URL = GALERI24_BUYBACK_SOURCE_URL;
export const UBS_BUYBACK_SOURCE = "galeri24-ubs";

export async function scrapeUbsBuyback(
  doFetch: typeof fetch = globalThis.fetch,
): Promise<number | null> {
  try {
    const res = await doFetch(UBS_BUYBACK_SOURCE_URL, { headers: BROWSER_HEADERS });
    if (!res.ok) return null;
    return extractBuybackFromHtml(await res.text(), "UBS");
  } catch {
    return null;
  }
}

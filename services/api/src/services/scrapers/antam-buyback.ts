import * as cheerio from "cheerio";

/**
 * Scraper for the Antam (Logam Mulia) gold **buyback** price — IDR per gram, the value
 * used to price physical / Pegadaian Tabungan Emas holdings (market `ANTAM`). Feeds the
 * existing `AntamProvider` via the internal `/internal/gold/antam-buyback` route (#109).
 *
 * Source: the official Antam page (logammulia.com/id/sell/gold) is the canonical buyback
 * but is served behind anti-bot protection that returns HTTP 403 to non-browser clients,
 * so it is unusable from the server. We instead read harga-emas.org, which republishes the
 * official Antam LM buyback ("Harga pembelian kembali"). The source URL + extraction are
 * isolated here so swapping back to a directly-fetchable Antam endpoint later is a one-liner.
 *
 * Returns `null` on any failure (unreachable, layout change, no number) — the provider
 * already treats that as "no quote" and the chain falls through to spot / fixture.
 */
export const ANTAM_BUYBACK_SOURCE_URL = "https://harga-emas.org/";
export const ANTAM_BUYBACK_SOURCE = "harga-emas";

// A desktop browser UA + language headers: aggregators (and the original Antam page) reject
// obvious bots, so present like a real browser.
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "id,en;q=0.8",
};

export async function scrapeAntamBuyback(
  doFetch: typeof fetch = globalThis.fetch,
): Promise<number | null> {
  try {
    const res = await doFetch(ANTAM_BUYBACK_SOURCE_URL, { headers: BROWSER_HEADERS });
    if (!res.ok) return null;
    return extractBuybackFromHtml(await res.text());
  } catch {
    return null;
  }
}

/**
 * Pull the per-gram buyback out of the harga-emas.org markup. The page renders
 * `Update harga LM Antam: <date>` followed by `Harga pembelian kembali: Rp2.591.100 /grm`.
 * We flatten the DOM to text (cheerio drops the interleaved HTML comments the page emits)
 * and read the first amount after that label, stripping Indonesian thousands separators.
 */
export function extractBuybackFromHtml(html: string): number | null {
  const text = cheerio.load(html)("body").text().replace(/\s+/g, " ");
  const m = text.match(/Harga pembelian kembali:\s*Rp\s*([\d.]+)/i);
  if (!m) return null;
  const value = Number(m[1].replace(/\./g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

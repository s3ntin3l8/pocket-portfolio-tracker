import { webUrl } from "./stack-env.mjs";

/**
 * `next dev` compiles each route on first request (tens of seconds under load), which
 * would turn the first `g <key>` navigation of every route into a spurious timeout.
 * Warm them once, sequentially (also paces requests against the API rate limit).
 */
export default async function globalSetup() {
  for (const path of [
    "/en/holdings",
    "/en/transactions",
    "/en/reports",
    "/en/insights",
    "/en/settings",
  ]) {
    const res = await fetch(`${webUrl}${path}`, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`warm-up ${path} failed: ${res.status}`);
  }
}

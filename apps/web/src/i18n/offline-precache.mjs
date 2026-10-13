/**
 * Precache entries for the per-locale offline fallback pages. `src/app/sw.ts` falls back to
 * `/${locale}/offline` for every locale, so each one must be in the precache manifest or an
 * offline navigation under that locale gets the browser's error page. Plain .mjs (not .ts)
 * so next.config.mjs and the unit test can both import it without a TS loader.
 *
 * @param {readonly string[]} locales
 * @param {string} revision per-build cache-busting revision
 */
export function offlinePrecacheEntries(locales, revision) {
  return locales.map((locale) => ({ url: `/${locale}/offline`, revision }));
}

import { routing } from "../i18n/routing";

/**
 * Extract a safe `/<locale>` path prefix from a raw `Cookie` header's NEXT_LOCALE value.
 * Validated against `routing.locales`: NEXT_LOCALE isn't httpOnly, so an unvalidated value
 * (e.g. "/evil.com") interpolated straight into `Response.redirect` would be a
 * protocol-relative open redirect (`Response.redirect("//evil.com/...")`). Falls back to ""
 * (no prefix, which next-intl maps to the default locale) for anything unrecognized.
 *
 * Split out of `sw.ts` (rather than kept inline) so it's unit-testable without importing
 * the service worker module itself, which registers real `self`/`Serwist` side effects at
 * import time that don't run under a plain test environment.
 */
export function resolveLocalePrefix(cookieHeader: string): string {
  const localeMatch = /(?:^|;\s*)NEXT_LOCALE=([^;]+)/.exec(cookieHeader);
  if (!localeMatch) return "";
  let rawLocale: string;
  try {
    rawLocale = decodeURIComponent(localeMatch[1]);
  } catch {
    return "";
  }
  return (routing.locales as readonly string[]).includes(rawLocale) ? `/${rawLocale}` : "";
}

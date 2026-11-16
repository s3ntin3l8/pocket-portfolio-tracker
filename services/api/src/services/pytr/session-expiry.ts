/**
 * When does the stored Trade Republic login stop working?
 *
 * Trade Republic's session cookies carry no cookie expiry (they are session cookies), but the
 * `tr_refresh` cookie is a JWT whose `exp` is its issue time + 24 h. Neither the hourly sync nor
 * the short-lived `tr_session` token extends it: a pairing lives exactly 24 h, then the next sync
 * fails and the connection flips to `expired`. So the expiry is *derived* here from the stored
 * cookie jar (never stored as primary state), and only the `exp` claim is ever read: no other
 * claim is parsed into anything, logged or returned.
 */

/** From this far before expiry the Holdings banner offers an early Renew. */
export const RENEW_BANNER_WINDOW_MS = 6 * 60 * 60 * 1000;
/** From this far before expiry the user gets one push notification (per pairing). */
export const RENEW_NOTIFY_WINDOW_MS = 3 * 60 * 60 * 1000;

const REFRESH_COOKIE = "tr_refresh";

/** `exp` of the `tr_refresh` token in a Mozilla cookie-jar text, or null when it can't be read. */
export function sessionExpiresAt(cookieJar: string): Date | null {
  for (const raw of cookieJar.split("\n")) {
    const line = raw.replace(/^#HttpOnly_/, "");
    if (!line.trim() || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length < 7 || fields[5] !== REFRESH_COOKIE) continue;
    const exp = expOf(fields[6].trim());
    if (exp !== null) return new Date(exp * 1000);
  }
  return null;
}

function expOf(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const exp = (payload as { exp?: unknown } | null)?.exp;
    return typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? exp : null;
  } catch {
    return null;
  }
}

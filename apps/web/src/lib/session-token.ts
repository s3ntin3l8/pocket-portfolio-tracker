import "server-only";
import { getToken } from "next-auth/jwt";

/**
 * Auth.js v5 cookie-security derivation mirrors AUTH_URL's own scheme (matches
 * `trustHost`'s reasoning in auth.ts): trusting the incoming request's own perceived
 * protocol is NOT safe here, since Traefik terminates TLS and the request reaching this
 * Next.js server can appear as plain HTTP even when the original client request was
 * HTTPS — that would make getToken() look for the wrong (unprefixed) cookie name and
 * silently 401 real sessions in production.
 */
function secureCookie(): boolean {
  try {
    return new URL(process.env.AUTH_URL ?? "").protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Read the Authentik access token from the session cookie, given a raw `Cookie` header
 * value. Server-only: the token must never reach client code (see the `session` callback
 * in auth.ts, which deliberately omits it from the client-visible session). Shared by the
 * same-origin proxy (app/api/backend/[...path]/route.ts, for client-side reads) and RSC
 * reads (lib/server-api.ts) so both resolve the token identically.
 *
 * Only the `cookie` header is passed to getToken() (never a full request object) so a
 * client-sent `Authorization` header — which getToken() would otherwise accept as a
 * fallback session-token source — can never be mistaken for a session cookie.
 */
export async function accessTokenFromCookieHeader(cookieHeader: string): Promise<string | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const token = await getToken({
    req: { headers: new Headers({ cookie: cookieHeader }) },
    secret,
    secureCookie: secureCookie(),
  });
  return typeof token?.accessToken === "string" ? token.accessToken : null;
}

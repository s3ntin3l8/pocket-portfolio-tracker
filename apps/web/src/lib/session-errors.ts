/** Session errors (set on the JWT by auth.ts) that mean the access token is dead and cannot
 *  be silently rotated. Shared by the client SessionErrorGuard and the server-side
 *  getSessionState so the landing redirect can never disagree with the guard (a mismatch
 *  would loop landing -> /holdings -> guard -> "/"). */
export const UNRECOVERABLE_SESSION_ERRORS: ReadonlySet<string> = new Set([
  "RefreshAccessTokenError",
  "RefreshTokenMissing",
]);

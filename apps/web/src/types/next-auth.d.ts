import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    // Deliberately no `accessToken` here — the browser must never hold the raw
    // Authentik access token (see the same-origin proxy at app/api/backend/[...path]).
    // It lives only on the JWT (below), read server-side via next-auth/jwt's getToken().
    /** Set when token refresh fails — the UI should prompt a fresh sign-in. */
    error?: string;
    user: DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    /** Absolute access-token expiry, unix seconds. */
    expiresAt?: number;
    error?: string;
  }
}

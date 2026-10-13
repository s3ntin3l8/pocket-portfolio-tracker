"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { createApiClient, type ApiClient } from "@portfolio/api-client";

/**
 * Same-origin proxy path (see app/api/backend/[...path]/route.ts) — the browser never
 * holds the Authentik access token itself. The proxy resolves the token server-side from
 * the httpOnly session cookie on every request, which also solves for free what a client-
 * held token couldn't: a multi-file import's background materialize loop (and its Retry
 * action) can outlive the ~5-min access-token lifetime, but the proxy always re-reads a
 * fresh one — no stale-token 401 mid-batch, no client-side rotation/ref-tracking needed.
 */
export const apiBaseUrl = "/api/backend";

/** A typed api-client bound to the same-origin proxy. No client-held token: the proxy
 *  attaches the current session's Authentik access token server-side (see apiBaseUrl). */
/** 401 error codes that mean "the session is gone" — only these send the user to sign-in.
 *  `unauthorized` is the same-origin proxy's own no-session answer (api/backend route); the
 *  rest come from the API's auth plugin. Any other 401 body (or a non-401) is a normal
 *  failure the calling component surfaces itself. */
const SESSION_LOST_CODES = new Set([
  "missing_token",
  "invalid_token",
  "auth_migrated_relogin",
  "unauthorized",
]);

export function useApiClient(): ApiClient {
  const router = useRouter();
  const locale = useLocale();
  return useMemo(() => {
    return createApiClient({
      baseUrl: apiBaseUrl,
      fetch: async (input, init) => {
        const res = await fetch(input, init);
        if (res.status === 401) {
          // The API's `auth_migrated_relogin` code means a local-auth user just made
          // their first OIDC login — the row's authSub was rewritten to the OIDC sub,
          // which invalidates the local JWT they were carrying. Stash a flag so the
          // landing page can show "account linked, please sign in again" instead of
          // dropping them at the form with no explanation. The flag is read once on
          // landing-page mount and cleared, so it can't outlive the redirect.
          let code: unknown;
          if (res.headers.get("content-type")?.includes("application/json")) {
            const body = await res
              .clone()
              .json()
              .catch(() => ({}));
            code = body?.error;
          }
          if (code === "auth_migrated_relogin") {
            sessionStorage.setItem("pocket:auth-migrated", "1");
          }
          // Only a genuinely lost session redirects; e.g. a wrong current password is a 400
          // now, and an unrelated 401 must not discard the user's in-progress form.
          // Not gated on which auth mode is configured — routing to the locale's landing
          // page, which already renders the right form for whichever mode is active, needs
          // no flag at all. (Was: `signIn("authentik")`, which lands on Auth.js's bare
          // signin page whenever Authentik isn't the configured auth mode.)
          if (typeof code === "string" && SESSION_LOST_CODES.has(code)) {
            router.push(`/${locale}`);
          }
        }
        return res;
      },
    });
  }, [router, locale]);
}

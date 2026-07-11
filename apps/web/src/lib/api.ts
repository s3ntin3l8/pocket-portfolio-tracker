"use client";

import { useMemo } from "react";
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
export function useApiClient(): ApiClient {
  // Stable client: there's no per-session state to track anymore, so this never needs
  // re-creating across renders.
  return useMemo(() => createApiClient({ baseUrl: apiBaseUrl }), []);
}

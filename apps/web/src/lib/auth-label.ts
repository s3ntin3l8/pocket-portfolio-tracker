/** True when the web app is running on the `DEV_AUTH_TOKEN` bypass (never in production) —
 *  the same condition as `devToken` in `lib/server-api/_shared.ts`. Server-side only. */
export function isDevAuthBypass(): boolean {
  return process.env.NODE_ENV !== "production" && Boolean(process.env.DEV_AUTH_TOKEN);
}

/** Which `Settings.*` message describes how the current user is signed in (audit G8). The dev
 *  bypass wins: its user would otherwise be mislabelled "Signed in via Authentik (OIDC)". */
export function authViaKey(authSub: string | undefined, devBypass: boolean) {
  if (devBypass) return "authViaDev" as const;
  return authSub?.startsWith("local|") ? ("authViaLocal" as const) : ("authVia" as const);
}

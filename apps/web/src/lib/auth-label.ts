/** Which `Settings.*` message describes how the current user is signed in (audit G8). The dev
 *  bypass wins: its user would otherwise be mislabelled "Signed in via Authentik (OIDC)". */
export function authViaKey(authSub: string | undefined, devBypass: boolean) {
  if (devBypass) return "authViaDev" as const;
  // `undefined` (no profile loaded) and OIDC subs both land on "authVia": OIDC is the only
  // remaining sign-in mode, and a signed-in page always has a profile, so this is not a gap.
  return authSub?.startsWith("local|") ? ("authViaLocal" as const) : ("authVia" as const);
}

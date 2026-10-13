/** Which `Settings.*` message describes how the current user is signed in (audit G8). The dev
 *  bypass wins: its user would otherwise be mislabelled "Signed in via Authentik (OIDC)". */
export function authViaKey(authSub: string | undefined, devBypass: boolean) {
  if (devBypass) return "authViaDev" as const;
  return authSub?.startsWith("local|") ? ("authViaLocal" as const) : ("authVia" as const);
}

/**
 * The end user's IP as resolved at the edge (Traefik): the first `x-forwarded-for` hop.
 * Only the first hop is kept so the header we forward upstream stays unambiguous
 * regardless of upstream configuration drift. The API trusts it only from proxies listed
 * in `TRUSTED_PROXY_CIDRS`.
 */
export function firstForwardedHop(headers: { get(name: string): string | null }): string | null {
  const xff = headers.get("x-forwarded-for");
  if (!xff) return null;
  return xff.split(",")[0]?.trim() || null;
}
